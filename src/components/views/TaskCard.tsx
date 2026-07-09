import { useState } from "react";
import { CardFrame } from "~/components/ui/CardFrame";
import { ShimmerBar } from "~/components/ui/ShimmerBar";
import { Btn } from "~/components/ui/Btn";
import { ConfirmDialog } from "~/components/ui/ConfirmDialog";
import { HotkeyTooltip } from "~/components/ui/Tooltip";
import { AgentLogo } from "~/components/ui/AgentLogo";
import { SessionIcon } from "~/components/ui/SessionIcon";
import { useDiagrams } from "~/lib/use-diagram-events";
import { AGENT_META, STATUS_META } from "~/lib/design-meta";
import { isSentinelTitle } from "~/lib/task-sentinels";
import { formatRelativeTime } from "~/lib/format-relative-time";
import { DEFAULT_SESSION_ICON, isSessionIcon } from "~/lib/session-icons";
import type { Task } from "~/db/schema";

export function TaskCard({
  task,
  selected,
  onToggle,
  onArchive,
  onRestore,
  onDelete,
  onTogglePinned,
  pinning = false,
}: {
  task: Task;
  selected: boolean;
  onToggle: (taskId: string) => void;
  /** Archive an active session (soft, no confirmation, kills the tty). */
  onArchive?: (taskId: string) => void;
  /** Restore an archived session back to the active list. */
  onRestore?: (taskId: string) => void;
  /** Permanently delete a session (confirmed, irreversible). */
  onDelete?: (taskId: string) => void;
  /** Pin or unpin an active session. */
  onTogglePinned?: (taskId: string) => Promise<void> | void;
  /** True while the pin/unpin mutation for this session is saving. */
  pinning?: boolean;
}) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmArchiveOpen, setConfirmArchiveOpen] = useState(false);
  const [hovered, setHovered] = useState(false);
  const { hasDiagram, openDiagram } = useDiagrams();
  const taskHasDiagram = hasDiagram(task.id);

  const meta = AGENT_META[task.agent];
  const statusMeta = STATUS_META[task.status];
  const isRunning = task.status === "running";

  // Archived sessions are parked (their tty was killed on archive), but the
  // card is still openable: clicking it reloads/resumes the session terminal.
  // The top-right actions swap delete → restore + permanent delete.
  const archived = task.archived;

  const sentinel = isSentinelTitle(task.title);
  const sessionIcon = isSessionIcon(task.icon) ? task.icon : DEFAULT_SESSION_ICON;
  const updated = formatRelativeTime(task.updatedAt);
  // Opens/focuses the session panel. Re-clicking a selected card does not
  // close it — only the panel's hide control does.
  const selectTask = () => onToggle(task.id);

  // Subtitle: prefer the live preview line, otherwise a status hint. On the
  // archived tab the column is "Archived", so mirror that on the card instead
  // of the underlying finished/disconnected status label.
  const subtitle =
    task.preview?.trim() || (archived ? "Archived" : statusMeta.label);

  return (
    <CardFrame
      glow
      focused={selected || hovered}
      style={{
        width: "100%",
        cursor: "pointer",
        transition: "box-shadow 0.15s, background 0.15s",
        // Keep the card's internal z-index layers below page-level overlays.
        zIndex: 0,
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <ShimmerBar active={isRunning} color={meta?.color} />
      <button
        type="button"
        onClick={selectTask}
        aria-label={`Open terminal for ${task.title}`}
        aria-pressed={selected}
        style={{
          position: "absolute",
          inset: 0,
          zIndex: 1,
          background: "transparent",
          border: 0,
          padding: 0,
          margin: 0,
          cursor: "pointer",
          borderRadius: "inherit",
        }}
      />

      {/* Agent brand watermark — faint, right side, decorative only. */}
      <div
        aria-hidden
        style={
          task.agent === "opencode"
            ? {
                position: "absolute",
                right: 8,
                top: "50%",
                transform: "translateY(-50%)",
                width: 96,
                height: 120,
                backgroundImage: "url('/opencode.svg')",
                backgroundRepeat: "no-repeat",
                backgroundPosition: "center",
                backgroundSize: "contain",
                opacity: 0.09,
                pointerEvents: "none",
                zIndex: 0,
              }
            : {
                position: "absolute",
                right: -10,
                top: "50%",
                transform: "translateY(-50%)",
                color: meta?.color ?? "var(--text)",
                opacity: 0.09,
                pointerEvents: "none",
                zIndex: 0,
                lineHeight: 0,
              }
        }
      >
        {task.agent !== "opencode" ? <AgentLogo agent={task.agent} size={140} /> : null}
      </div>

      <div
        style={{
          padding: 14,
          display: "flex",
          alignItems: "stretch",
          gap: 14,
          position: "relative",
          zIndex: 2,
          pointerEvents: "none",
        }}
      >
        {/* Left icon tile + status dot */}
        <div style={{ position: "relative", flexShrink: 0 }}>
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: 14,
              background: "linear-gradient(180deg, var(--surface-2), var(--surface-1))",
              border: "1px solid var(--border)",
              boxShadow:
                "inset 0 1px 0 rgba(255,255,255,0.04), 0 1px 2px rgba(0,0,0,0.35)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--text-dim)",
            }}
          >
            <SessionIcon name={sessionIcon} size={26} strokeWidth={1.5} />
          </div>
          {statusMeta.dot && (
            <span
              style={{
                position: "absolute",
                top: -3,
                left: -3,
                width: 12,
                height: 12,
                borderRadius: "50%",
                background: statusMeta.color,
                border: "2px solid var(--surface-0)",
                boxShadow: isRunning ? `0 0 8px ${statusMeta.color}` : "none",
                animation: isRunning ? "pulse-dot 1.6s ease-in-out infinite" : "none",
              }}
            />
          )}
        </div>

        {/* Right: title / subtitle / meta row */}
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
          <div
            style={{
              fontSize: 14.5,
              fontWeight: 600,
              lineHeight: 1.3,
              color: sentinel ? "var(--text-dim)" : "var(--text)",
              fontStyle: sentinel ? "italic" : "normal",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              paddingRight: 36,
            }}
          >
            {task.title}
          </div>

          <div
            style={{
              fontSize: 12.5,
              color: "var(--text-dim)",
              lineHeight: 1.4,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              fontStyle: !task.preview?.trim() ? "italic" : "normal",
            }}
          >
            {subtitle}
            {isRunning && task.preview?.trim() && (
              <span
                style={{
                  marginLeft: 2,
                  animation: "caret 1s infinite",
                  color: meta?.color,
                }}
              >
                ▊
              </span>
            )}
          </div>

          <div
            style={{
              marginTop: 4,
              fontFamily: "var(--mono)",
              fontSize: 11,
              color: "var(--text-faint)",
            }}
          >
            {updated}
          </div>
        </div>

        {/* Top-right session actions */}
        {(onTogglePinned || onArchive || onRestore || onDelete) && (
          <div
            style={{
              position: "absolute",
              top: 10,
              right: 10,
              display: "flex",
              alignItems: "center",
              gap: 6,
              pointerEvents: "auto",
              zIndex: 3,
            }}
          >
            {!archived && onTogglePinned && (
              <Btn
                variant="ghost"
                size="sm"
                icon={task.pinned ? "pin-fill" : "pin"}
                disabled={pinning}
                aria-busy={pinning}
                aria-label={`${task.pinned ? "Unpin" : "Pin"} ${task.title}`}
                title={pinning ? "Saving pin state" : task.pinned ? "Unpin session" : "Pin session"}
                onClick={(e) => {
                  e.stopPropagation();
                  if (pinning) return;
                  void onTogglePinned(task.id);
                }}
                style={{
                  width: 30,
                  height: 30,
                  padding: 0,
                  color: task.pinned ? "var(--accent-ink)" : undefined,
                }}
              />
            )}
            {archived && onRestore && (
              <Btn
                variant="ghost"
                size="sm"
                icon="refresh"
                aria-label={`Restore ${task.title}`}
                title="Restore session"
                onClick={(e) => {
                  e.stopPropagation();
                  onRestore(task.id);
                }}
                style={{ width: 30, height: 30, padding: 0 }}
              />
            )}
            {!archived && onArchive && (
              <HotkeyTooltip
                action="session.closeWindow"
                label="Archive session"
                disabled={!selected}
              >
                <Btn
                  variant="ghost"
                  size="sm"
                  icon="archive"
                  aria-label={`Archive ${task.title}`}
                  title={selected ? undefined : "Archive session"}
                  onClick={(e) => {
                    e.stopPropagation();
                    // Running sessions lose the live terminal + agent on
                    // archive, so confirm first; parked ones archive silently.
                    if (isRunning) setConfirmArchiveOpen(true);
                    else onArchive(task.id);
                  }}
                  style={{ width: 30, height: 30, padding: 0 }}
                />
              </HotkeyTooltip>
            )}
            {onDelete && (
              <HotkeyTooltip
                action="session.closeWindow"
                label="Delete session"
                disabled={!selected}
              >
                <Btn
                  variant="ghost"
                  size="sm"
                  icon="trash"
                  aria-label={`Delete ${task.title}`}
                  title={selected ? undefined : "Delete session"}
                  onClick={(e) => {
                    e.stopPropagation();
                    setConfirmOpen(true);
                  }}
                  style={{ width: 30, height: 30, padding: 0 }}
                />
              </HotkeyTooltip>
            )}
          </div>
        )}

        {(taskHasDiagram ||
          task.status === "needs-input" ||
          task.status === "interrupted") && (
          <div
            style={{
              position: "absolute",
              bottom: 10,
              right: 10,
              display: "flex",
              alignItems: "center",
              gap: 6,
              pointerEvents: "auto",
              zIndex: 3,
            }}
          >
            {taskHasDiagram && (
              <Btn
                size="sm"
                variant="ghost"
                icon="chart"
                title="View session diagram"
                aria-label="View session diagram"
                onClick={(e) => {
                  e.stopPropagation();
                  void openDiagram(task.id);
                }}
              >
                Diagram
              </Btn>
            )}
            {(task.status === "needs-input" || task.status === "interrupted") && (
              <Btn
                size="sm"
                variant="accent"
                icon="terminal"
                onClick={(e) => {
                  e.stopPropagation();
                  selectTask();
                }}
              >
                Reply
              </Btn>
            )}
          </div>
        )}

      </div>

      {onArchive && (
        <div onClick={(e) => e.stopPropagation()}>
          <ConfirmDialog
            open={confirmArchiveOpen}
            onClose={() => setConfirmArchiveOpen(false)}
            onConfirm={() => {
              onArchive(task.id);
              setConfirmArchiveOpen(false);
            }}
            title="Archive running session?"
            confirmLabel="Archive"
            cancelLabel="Keep running"
            variant="danger"
            icon="archive"
            width={420}
          >
            <div style={{ fontSize: 13, color: "var(--text)", marginBottom: 6, overflowWrap: "anywhere" }}>
              &ldquo;{task.title}&rdquo; is still running.
            </div>
            <div style={{ fontSize: 12, color: "var(--text-dim)" }}>
              Archiving disconnects its terminal and stops the in-progress agent.
              You can restore the session later, but the current run won&rsquo;t
              resume.
            </div>
          </ConfirmDialog>
        </div>
      )}

      {onDelete && (
        <div onClick={(e) => e.stopPropagation()}>
          <ConfirmDialog
            open={confirmOpen}
            onClose={() => setConfirmOpen(false)}
            onConfirm={() => {
              onDelete(task.id);
              setConfirmOpen(false);
            }}
            title="Delete session?"
            confirmLabel="Delete"
            icon="trash"
            width={420}
          >
            <div style={{ fontSize: 13, color: "var(--text)", marginBottom: 6, overflowWrap: "anywhere" }}>
              Delete &ldquo;{task.title}&rdquo;?
            </div>
            <div style={{ fontSize: 12, color: "var(--text-dim)" }}>
              This session and its git worktree will be removed. This cannot be
              undone.
            </div>
          </ConfirmDialog>
        </div>
      )}
    </CardFrame>
  );
}
