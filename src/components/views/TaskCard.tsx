import { useState } from "react";
import { Icon } from "~/components/ui/Icon";
import { CardFrame } from "~/components/ui/CardFrame";
import { ShimmerBar } from "~/components/ui/ShimmerBar";
import { Btn } from "~/components/ui/Btn";
import { ConfirmDialog } from "~/components/ui/ConfirmDialog";
import { AgentLogo } from "~/components/ui/AgentLogo";
import { SessionIcon } from "~/components/ui/SessionIcon";
import { useDiagrams } from "~/lib/use-diagram-events";
import { AGENT_META, STATUS_META } from "~/lib/design-meta";
import { isSentinelTitle } from "~/lib/task-sentinels";
import { DEFAULT_SESSION_ICON, isSessionIcon } from "~/lib/session-icons";
import type { Task } from "~/db/schema";

export function TaskCard({
  task,
  selected,
  onToggle,
  onDelete,
}: {
  task: Task;
  selected: boolean;
  onToggle: (taskId: string) => void;
  onDelete?: (taskId: string) => void;
}) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [hovered, setHovered] = useState(false);
  const { hasDiagram, openDiagram } = useDiagrams();
  const taskHasDiagram = hasDiagram(task.id);

  const meta = AGENT_META[task.agent];
  const statusMeta = STATUS_META[task.status];
  const isRunning = task.status === "running";

  const sentinel = isSentinelTitle(task.title);
  const sessionIcon = isSessionIcon(task.icon) ? task.icon : DEFAULT_SESSION_ICON;
  const updated = formatRelative(task.updatedAt);
  const toggleTask = () => onToggle(task.id);

  // Subtitle: prefer the live preview line, otherwise a status hint.
  const subtitle = task.preview?.trim() || statusMeta.label;

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
        onClick={toggleTask}
        aria-label={`${selected ? "Close" : "Open"} terminal for ${task.title}`}
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
        style={{
          position: "absolute",
          right: -10,
          top: "50%",
          transform: "translateY(-50%)",
          color: meta?.color ?? "var(--text)",
          opacity: 0.09,
          pointerEvents: "none",
          zIndex: 0,
          lineHeight: 0,
        }}
      >
        <AgentLogo agent={task.agent} size={140} />
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
              display: "flex",
              alignItems: "center",
              gap: 8,
              fontFamily: "var(--mono)",
              fontSize: 11,
              color: "var(--text-faint)",
            }}
          >
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              <Icon name="git-branch" size={11} /> {task.branch}
            </span>
            <span>·</span>
            <span>{updated}</span>
          </div>
        </div>

        {/* Top-right delete */}
        {onDelete && (
          <div
            style={{
              position: "absolute",
              top: 10,
              right: 10,
              display: "flex",
              alignItems: "center",
              pointerEvents: "auto",
              zIndex: 3,
            }}
          >
            <Btn
              variant="ghost"
              size="sm"
              icon="trash"
              aria-label={`Delete ${task.title}`}
              title="Delete session"
              onClick={(e) => {
                e.stopPropagation();
                setConfirmOpen(true);
              }}
              style={{ width: 30, height: 30, padding: 0 }}
            />
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
                  toggleTask();
                }}
              >
                Reply
              </Btn>
            )}
          </div>
        )}

      </div>

      {onDelete && (
        <div onClick={(e) => e.stopPropagation()}>
          <ConfirmDialog
            open={confirmOpen}
            onClose={() => setConfirmOpen(false)}
            onConfirm={() => {
              onDelete(task.id);
              setConfirmOpen(false);
            }}
            title="Delete task"
            confirmLabel="Delete"
            icon="trash"
            width={420}
          >
            <div style={{ fontSize: 13, color: "var(--text)", marginBottom: 6 }}>
              Delete &ldquo;{task.title}&rdquo;?
            </div>
            <div style={{ fontSize: 12, color: "var(--text-dim)" }}>
              This task and its worktree will be removed. This cannot be undone.
            </div>
          </ConfirmDialog>
        </div>
      )}
    </CardFrame>
  );
}

function formatRelative(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return "just now";
  const m = Math.floor(diff / 60_000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}
