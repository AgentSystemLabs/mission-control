import { useEffect, useRef, useState } from "react";
import type { Terminal as XTerm } from "@xterm/xterm";
import type { FitAddon as XFitAddon } from "@xterm/addon-fit";
import { Icon } from "~/components/ui/Icon";
import { ProjectIcon } from "~/components/ui/ProjectIcon";
import { ShimmerBar } from "~/components/ui/ShimmerBar";
import { StatusDot } from "~/components/ui/StatusDot";
import { AGENT_META, STATUS_META } from "~/lib/design-meta";
import { getElectron } from "~/lib/electron";
import { mapTerminalKey } from "~/lib/terminal-keymap";
import { api } from "~/lib/api";
import type { Project, Task } from "~/db/schema";

async function resolveMcEnv(electron: NonNullable<ReturnType<typeof getElectron>>) {
  try {
    const [port, settings] = await Promise.all([
      electron.getRuntimePort(),
      api.getSettings(),
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
  collapsed = false,
  onToggleCollapsed,
}: {
  project: Project;
  task: Task;
  onClose: () => void;
  isLast: boolean;
  descriptor: TerminalDescriptor;
  onPtyReady: (ptyId: string) => void;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const fitRef = useRef<XFitAddon | null>(null);
  const [bridgeMissing, setBridgeMissing] = useState(false);

  const meta = AGENT_META[task.agent];
  const statusMeta = STATUS_META[task.status];
  const isRunning = task.status === "running";

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

      const term = new Terminal({
        fontFamily: 'Geist Mono, ui-monospace, "SF Mono", Menlo, monospace',
        fontSize: 12,
        lineHeight: 1.4,
        cursorBlink: true,
        theme: {
          background: "#050607",
          foreground: "#e8e6df",
          cursor: meta?.color ?? "#7ce58a",
          black: "#0a0b0d",
          brightBlack: "#22262c",
          white: "#e8e6df",
          brightWhite: "#ffffff",
        },
        allowProposedApi: true,
        scrollback: 5000,
      });
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
      term.attachCustomKeyEventHandler((e) => {
        const bytes = mapTerminalKey(e);
        if (bytes === null) return true;
        if (activePtyId) electron.pty.write(activePtyId, bytes);
        return false;
      });

      const wireToPty = (ptyId: string) => {
        activePtyId = ptyId;
        subscriptions.push(
          electron.pty.onData((msg) => {
            if (msg.ptyId === ptyId) term.write(msg.data);
          }),
          electron.pty.onExit((msg) => {
            if (msg.ptyId === ptyId) {
              term.writeln("");
              term.writeln(`\x1b[2m[process exited (code=${msg.exitCode})]\x1b[0m`);
              void (async () => {
                try {
                  const settings = await api.getSettings();
                  await api.updateTaskStatus(
                    descriptor.taskId,
                    { status: "terminated" },
                    settings.apiToken
                  );
                } catch {
                  /* best effort */
                }
              })();
            }
          })
        );
        term.onData((data) => {
          electron.pty.write(ptyId, data);
        });
        term.onResize(({ cols, rows }) => {
          electron.pty.resize(ptyId, cols, rows);
        });
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

          const mcEnv = await resolveMcEnv(electron);
          const { ptyId } = await electron.pty.spawn({
            taskId: descriptor.taskId,
            cwd: descriptor.cwd,
            command: descriptor.startCommand,
            cols: term.cols,
            rows: term.rows,
            agent: task.agent,
            mcEnv,
          });
          if (cancelled) {
            await electron.pty.kill(ptyId).catch(() => undefined);
            return;
          }
          onPtyReady(ptyId);
          wireToPty(ptyId);
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

  // When the pane re-expands, the xterm container goes from `display:none` back
  // to `block` — ResizeObserver doesn't always fire that transition reliably,
  // so re-fit explicitly to match the now-visible container.
  useEffect(() => {
    if (collapsed) return;
    const id = window.requestAnimationFrame(() => {
      try {
        fitRef.current?.fit();
      } catch {
        /* container not measured yet */
      }
    });
    return () => cancelAnimationFrame(id);
  }, [collapsed]);

  return (
    <div
      style={{
        flex: collapsed ? "0 0 auto" : 1,
        minHeight: collapsed ? 0 : 120,
        display: "flex",
        flexDirection: "column",
        borderBottom: isLast ? "none" : "1px solid var(--border)",
        overflow: "hidden",
      }}
    >
      <div
        onClick={onToggleCollapsed}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "8px 12px",
          background: "var(--surface-1)",
          borderBottom: collapsed ? "none" : "1px solid var(--border)",
          flexShrink: 0,
          cursor: onToggleCollapsed ? "pointer" : "default",
          userSelect: "none",
        }}
      >
        {onToggleCollapsed && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggleCollapsed();
            }}
            aria-label={collapsed ? "Expand terminal" : "Collapse terminal"}
            title={collapsed ? "Expand" : "Collapse"}
            style={{
              background: "transparent",
              border: 0,
              padding: 2,
              color: "var(--text-faint)",
              cursor: "pointer",
              display: "flex",
            }}
          >
            <Icon name={collapsed ? "chevron-right" : "chevron-down"} size={11} />
          </button>
        )}
        <StatusDot status={task.status} size={7} />
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
            {task.title}
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
          display: collapsed ? "none" : "block",
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
