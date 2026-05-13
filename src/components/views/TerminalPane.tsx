import { useState } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { Btn } from "~/components/ui/Btn";
import { ProjectIcon } from "~/components/ui/ProjectIcon";
import { ShimmerBar } from "~/components/ui/ShimmerBar";
import { StatusDot } from "~/components/ui/StatusDot";
import { AGENT_META, STATUS_META } from "~/lib/design-meta";
import { getElectron } from "~/lib/electron";
import { api } from "~/lib/api";
import { buildClaudeCommand, newSessionId } from "~/lib/claude-command";
import { terminalInputStartsTurn } from "~/lib/task-status-sync";
import { useXtermPty } from "~/lib/use-xterm-pty";
import { queryKeys, settingsQueryOptions, useTasks } from "~/queries";
import { XtermSurface } from "~/components/views/XtermSurface";
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
  onHide,
  expanded = false,
  onToggleExpanded,
  isLast,
  descriptor,
  onPtyReady,
}: {
  project: Project;
  task: Task;
  onClose: () => void;
  onHide?: () => void;
  expanded?: boolean;
  onToggleExpanded?: () => void;
  isLast: boolean;
  descriptor: TerminalDescriptor;
  onPtyReady: (ptyId: string) => void;
}) {
  const queryClient = useQueryClient();

  const { data: liveTasks } = useTasks(project.id);
  const liveTask = liveTasks?.find((t) => t.id === task.id) ?? task;
  const meta = AGENT_META[liveTask.agent];
  const statusMeta = STATUS_META[liveTask.status];
  const isRunning = liveTask.status === "running";

  const { containerRef, bridgeMissing } = useXtermPty({
    key: descriptor.taskId,
    cursorColor: meta?.color,
    onTerm: ({ term, fit, electron, setActivePtyId, isCancelled }) => {
      const subscriptions: Array<() => void> = [];
      let fallbackRunningPosted = false;

      // If a `claude --resume <uuid>` spawn dies almost immediately, the
      // session file is gone or unreadable. Per the persistence design we
      // start fresh under a NEW uuid instead of deleting the task card.
      const RESUME_FAST_EXIT_MS = 3000;
      let spawnAt = 0;
      let spawnedAsResume = false;

      const wireToPty = (ptyId: string) => {
        setActivePtyId(ptyId);
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
          if (!fallbackRunningPosted && terminalInputStartsTurn(task.agent, data)) {
            fallbackRunningPosted = true;
            void (async () => {
              try {
                const settings = await queryClient.ensureQueryData(settingsQueryOptions());
                await api.updateTaskStatus(descriptor.taskId, { status: "running" }, settings.apiToken);
                await Promise.all([
                  queryClient.invalidateQueries({ queryKey: queryKeys.tasks(project.id) }),
                  queryClient.invalidateQueries({ queryKey: queryKeys.project(project.id) }),
                  queryClient.invalidateQueries({ queryKey: queryKeys.projects }),
                ]);
              } catch {
                fallbackRunningPosted = false;
              }
            })();
          }
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
        if (isCancelled()) return;
        wireToPty(ptyId);
      };

      const ensurePty = async () => {
        if (isCancelled()) return;
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
          if (!isCancelled() && buf) term.write(buf);
          return;
        }

        const isResume =
          task.agent === "claude-code" &&
          descriptor.startCommand.includes("--resume");
        await spawnAndWire(descriptor.startCommand, isResume);
      };

      const rafHandle = window.requestAnimationFrame(() => {
        void ensurePty().catch((err: any) => {
          try {
            term.writeln(`\x1b[31m[failed to start pty: ${err?.message || err}]\x1b[0m`);
          } catch {
            /* terminal may be disposed */
          }
        });
      });

      return () => {
        cancelAnimationFrame(rafHandle);
        for (const off of subscriptions) off();
      };
    },
  });

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
          background: "transparent",
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
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          {onToggleExpanded && (
            <Btn
              variant="ghost"
              size="sm"
              icon={expanded ? "minimize" : "maximize"}
              onClick={onToggleExpanded}
              title={expanded ? "Shrink session panel" : "Expand session panel"}
              aria-label={expanded ? "Shrink session panel" : "Expand session panel"}
              aria-pressed={expanded}
              style={{ width: 34, padding: 0 }}
            />
          )}
          {onHide && (
            <Btn
              variant="ghost"
              size="sm"
              icon="x"
              onClick={onHide}
              title="Hide session panel"
              aria-label="Hide session panel"
              style={{ width: 34, padding: 0 }}
            />
          )}
        </div>
      </div>
      <ShimmerBar active={isRunning} color={meta?.color} />
      <XtermSurface
        containerRef={containerRef}
        bridgeMissing={bridgeMissing}
        bridgeMissingMessage={
          <>
            Terminals require the Electron runtime. Open MissionControl through{" "}
            <code style={{ color: "var(--accent)" }}>pnpm dev</code>.
          </>
        }
      />
    </div>
  );
}
