import { useEffect, useRef, useState } from "react";
import type { FitAddon as XFitAddon } from "@xterm/addon-fit";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { Icon } from "~/components/ui/Icon";
import { ProjectIcon } from "~/components/ui/ProjectIcon";
import { ShimmerBar } from "~/components/ui/ShimmerBar";
import { StatusDot } from "~/components/ui/StatusDot";
import { AGENT_META, STATUS_META } from "~/lib/design-meta";
import { getElectron } from "~/lib/electron";
import { mapTerminalKey, shouldSuppressTerminalKey } from "~/lib/terminal-keymap";
import { createTerminalOptions } from "~/lib/terminal-options";
import { api } from "~/lib/api";
import { buildClaudeCommand, newSessionId } from "~/lib/claude-command";
import { queryKeys, settingsQueryOptions, useTasks } from "~/queries";
import type { Project, Task } from "~/db/schema";

async function resolveMcEnv(
  electron: NonNullable<ReturnType<typeof getElectron>>,
  queryClient: QueryClient
) {
  try {
    const [port, settings] = await Promise.all([
      electron.getRuntimePort(),
      queryClient.ensureQueryData(settingsQueryOptions()),
    ]);
    if (!port) return undefined;
    return { apiUrl: `http://127.0.0.1:${port}`, token: settings.apiToken };
  } catch {
    return undefined;
  }
}

export type TerminalDescriptor = {
  taskId: string;
  ptyId: string | null;
  startCommand: string;
  cwd: string;
};

export function TerminalPane({
  project,
  task,
  onClose,
  isLast,
  descriptor,
  onPtyReady,
}: {
  project: Project;
  task: Task;
  onClose: () => void;
  isLast: boolean;
  descriptor: TerminalDescriptor;
  onPtyReady: (ptyId: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const fitRef = useRef<XFitAddon | null>(null);
  const [bridgeMissing, setBridgeMissing] = useState(false);
  const queryClient = useQueryClient();

  const { data: liveTasks } = useTasks(project.id);
  const liveTask = liveTasks?.find((t) => t.id === task.id) ?? task;
  const meta = AGENT_META[liveTask.agent];
  const statusMeta = STATUS_META[liveTask.status];
  const isRunning = liveTask.status === "running";

  useEffect(() => {
    const electron = getElectron();
    if (!electron) {
      setBridgeMissing(true);
      return;
    }
    if (!containerRef.current) return;

    let cancelled = false;
    let cleanup: (() => void) | undefined;

    void (async () => {
      // Defer xterm to client-side dynamic import so SSR doesn't try to load
      // its CommonJS UMD bundle.
      const [{ Terminal }, { FitAddon }] = await Promise.all([
        import("@xterm/xterm"),
        import("@xterm/addon-fit"),
      ]);
      if (cancelled || !containerRef.current) return;

      const term = new Terminal(createTerminalOptions({ cursorColor: meta?.color }));
      const fit = new FitAddon();
      fitRef.current = fit;
      term.loadAddon(fit);
      term.open(containerRef.current);
      term.focus();

      const host = containerRef.current;
      const subscriptions: Array<() => void> = [];
      let rafHandle = 0;
      let activePtyId: string | null = null;

      // Dropping a file from Finder pastes its path into the PTY, matching
      // iTerm/Terminal.app behavior. Claude Code reads images by path.
      const onDragOver = (e: DragEvent) => {
        if (e.dataTransfer?.types.includes("Files")) {
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
        }
      };
      const onDrop = (e: DragEvent) => {
        const files = Array.from(e.dataTransfer?.files ?? []);
        if (!files.length) return;
        e.preventDefault();
        if (!activePtyId) return;
        const paths = files
          .map((f) => electron.getPathForFile(f))
          .filter(Boolean)
          .map((p) => (/[\s"'\\]/.test(p) ? `"${p.replace(/"/g, '\\"')}"` : p));
        if (!paths.length) return;
        electron.pty.write(activePtyId, paths.join(" ") + " ");
        term.focus();
      };
      host.addEventListener("dragover", onDragOver);
      host.addEventListener("drop", onDrop);

      // Shift+Enter must insert a literal newline in Claude Code's prompt;
      // xterm.js otherwise emits plain CR for both Enter and Shift+Enter,
      // which Claude treats as submit. Send ESC+CR (alt-enter), the same
      // sequence `claude /terminal-setup` registers for iTerm2/Terminal.app.
      // preventDefault is required: returning false makes xterm.js bail
      // before its own preventDefault, so the hidden textarea would also
      // insert `\n` and xterm's input handler would write it to the PTY.
      term.attachCustomKeyEventHandler((e) => {
        const bytes = mapTerminalKey(e);
        if (bytes === null) {
          if (!shouldSuppressTerminalKey(e)) return true;
          e.preventDefault();
          return false;
        }
        e.preventDefault();
        if (activePtyId) electron.pty.write(activePtyId, bytes);
        return false;
      });

      // If a `claude --resume <uuid>` spawn dies almost immediately, the
      // session file is gone or unreadable. Per the persistence design we
      // start fresh under a NEW uuid instead of deleting the task card.
      const RESUME_FAST_EXIT_MS = 3000;
      let spawnAt = 0;
      let spawnedAsResume = false;

      const wireToPty = (ptyId: string) => {
        activePtyId = ptyId;
        subscriptions.push(
          electron.pty.onData((msg) => {
            if (msg.ptyId === ptyId) term.write(msg.data);
          }),
          electron.pty.onExit((msg) => {
            if (msg.ptyId !== ptyId) return;
            const elapsed = Date.now() - spawnAt;
            if (
              spawnedAsResume &&
              task.agent === "claude-code" &&
              elapsed < RESUME_FAST_EXIT_MS
            ) {
              void (async () => {
                const fresh = newSessionId();
                try {
                  await api.updateTask(descriptor.taskId, { claudeSessionId: fresh });
                } catch {
                  /* best effort — even if patch fails, spawn with fresh id */
                }
                term.writeln(
                  `\x1b[33m[resume failed; starting a fresh Claude session]\x1b[0m`
                );
                const cmd = buildClaudeCommand({
                  kind: "new",
                  sessionId: fresh,
                  skipPermissions: !!task.claudeSkipPermissions,
                  bareSession: !!task.claudeBareSession,
                });
                await spawnAndWire(cmd, false);
              })();
              return;
            }
            void (async () => {
              try {
                await api.deleteTask(descriptor.taskId);
              } catch {
                /* best effort */
              }
              await queryClient.invalidateQueries({
                queryKey: queryKeys.tasks(project.id),
              });
              onClose();
            })();
          })
        );
        term.onData((data) => {
          electron.pty.write(ptyId, data);
        });
        term.onResize(({ cols, rows }) => {
          electron.pty.resize(ptyId, cols, rows);
        });
      };

      const spawnAndWire = async (command: string, isResume: boolean) => {
        const mcEnv = await resolveMcEnv(electron, queryClient);
        const { ptyId } = await electron.pty.spawn({
          taskId: descriptor.taskId,
          cwd: descriptor.cwd,
          command,
          cols: term.cols,
          rows: term.rows,
          agent: task.agent,
          mcEnv,
        });
        spawnAt = Date.now();
        spawnedAsResume = isResume;
        onPtyReady(ptyId);
        if (cancelled) return;
        wireToPty(ptyId);
      };

      const ensurePty = async () => {
        if (cancelled) return;
        try {
          try {
            fit.fit();
          } catch {
            /* container not measured yet */
          }

          if (descriptor.ptyId) {
            // Re-attach to a live PTY: subscribe BEFORE replay so any chunk
            // emitted between the calls is queued, not lost.
            wireToPty(descriptor.ptyId);
            const buf = await electron.pty.replay(descriptor.ptyId);
            if (!cancelled && buf) term.write(buf);
            return;
          }

          const isResume =
            task.agent === "claude-code" &&
            descriptor.startCommand.includes("--resume");
          await spawnAndWire(descriptor.startCommand, isResume);
        } catch (err: any) {
          term.writeln(`\x1b[31m[failed to start pty: ${err?.message || err}]\x1b[0m`);
        }
      };

      rafHandle = window.requestAnimationFrame(() => ensurePty());

      const ro = new ResizeObserver(() => {
        try {
          fit.fit();
        } catch {
          /* swallow */
        }
      });
      ro.observe(containerRef.current);

      cleanup = () => {
        cancelAnimationFrame(rafHandle);
        for (const off of subscriptions) off();
        host.removeEventListener("dragover", onDragOver);
        host.removeEventListener("drop", onDrop);
        ro.disconnect();
        fitRef.current = null;
        term.dispose();
      };
    })();

    return () => {
      cancelled = true;
      cleanup?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [descriptor.taskId]);

  return (
    <div
      style={{
        flex: 1,
        minHeight: 120,
        display: "flex",
        flexDirection: "column",
        borderBottom: isLast ? "none" : "1px solid var(--border)",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "8px 12px",
          background: "var(--surface-1)",
          borderBottom: "1px solid var(--border)",
          flexShrink: 0,
          userSelect: "none",
        }}
      >
        <StatusDot status={liveTask.status} size={7} />
        <ProjectIcon project={project} size={20} />
        <div style={{ flex: 1, minWidth: 0, overflow: "hidden" }}>
          <div
            style={{
              fontFamily: "var(--mono)",
              fontSize: 11.5,
              fontWeight: 500,
              color: "var(--text)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {liveTask.title}
          </div>
          <div
            style={{
              display: "flex",
              gap: 8,
              fontFamily: "var(--mono)",
              fontSize: 10,
              color: "var(--text-faint)",
              marginTop: 1,
            }}
          >
            <span style={{ color: meta?.color }}>
              {meta?.glyph} {meta?.label}
            </span>
            <span>·</span>
            <span>{project.name}</span>
            <span>·</span>
            <span style={{ color: statusMeta.color }}>{statusMeta.label}</span>
          </div>
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          style={{
            background: "transparent",
            border: 0,
            padding: 4,
            color: "var(--text-faint)",
            cursor: "pointer",
            display: "flex",
          }}
          title="Close"
        >
          <Icon name="x" size={11} />
        </button>
      </div>
      <ShimmerBar active={isRunning} color={meta?.color} />
      <div
        style={{
          flex: 1,
          position: "relative",
          background: "#050607",
        }}
      >
        {bridgeMissing ? (
          <div
            style={{
              padding: 16,
              fontFamily: "var(--mono)",
              fontSize: 12,
              color: "var(--text-dim)",
            }}
          >
            Terminals require the Electron runtime. Open MissionControl through{" "}
            <code style={{ color: "var(--accent)" }}>pnpm dev</code>.
          </div>
        ) : (
          <div ref={containerRef} style={{ position: "absolute", inset: 0 }} />
        )}
      </div>
    </div>
  );
}
