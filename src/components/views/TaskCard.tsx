import { useCallback, useState } from "react";
import { Icon } from "~/components/ui/Icon";
import { CardFrame } from "~/components/ui/CardFrame";
import { ShimmerBar } from "~/components/ui/ShimmerBar";
import { StatusDot } from "~/components/ui/StatusDot";
import { Btn } from "~/components/ui/Btn";
import { ConfirmDialog } from "~/components/ui/ConfirmDialog";
import { AgentGlyph } from "~/components/ui/AgentGlyph";
import { useDismissableMenu } from "~/lib/use-dismissable-menu";
import { AGENT_META, STATUS_META } from "~/lib/design-meta";
import { isSentinelTitle } from "~/lib/task-sentinels";
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
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [hovered, setHovered] = useState(false);

  const closeMenu = useCallback(() => setMenu(null), []);
  useDismissableMenu(menu !== null, closeMenu);

  const meta = AGENT_META[task.agent];
  const statusMeta = STATUS_META[task.status];
  const isRunning = task.status === "running";
  const showDeleteAction = hovered && !confirmOpen;

  const updated = formatRelative(task.updatedAt);
  const toggleTask = () => onToggle(task.id);

  return (
    <CardFrame
      glow
      focused={selected || hovered}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (onDelete) setMenu({ x: e.clientX, y: e.clientY });
      }}
      style={{
        width: "100%",
        cursor: "pointer",
        transition: "box-shadow 0.15s, background 0.15s",
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
      <div
        style={{
          padding: 14,
          display: "flex",
          flexDirection: "column",
          gap: 10,
          position: "relative",
          zIndex: 2,
          pointerEvents: "none",
        }}
      >
        <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
              <StatusDot status={task.status} size={7} />
              <span
                style={{
                  fontFamily: "var(--mono)",
                  fontSize: 10.5,
                  fontWeight: 500,
                  color: statusMeta.color,
                  letterSpacing: "0.05em",
                  textTransform: "uppercase",
                }}
              >
                {statusMeta.label}
              </span>
              <span style={{ color: "var(--text-faint)", fontSize: 10, fontFamily: "var(--mono)" }}>·</span>
              <AgentGlyph agent={task.agent} showLabel size={10.5} />
            </div>
            {(() => {
              const sentinel = isSentinelTitle(task.title);
              return (
                <div
                  style={{
                    fontSize: 13.5,
                    fontWeight: 500,
                    lineHeight: 1.35,
                    color: sentinel ? "var(--text-dim)" : "var(--text)",
                    fontStyle: sentinel ? "italic" : "normal",
                    marginBottom: 4,
                  }}
                >
                  {task.title}
                </div>
              );
            })()}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                fontFamily: "var(--mono)",
                fontSize: 10.5,
                color: "var(--text-faint)",
              }}
            >
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                <Icon name="git-branch" size={10} /> {task.branch}
              </span>
              <span>·</span>
              <span>{updated}</span>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {onDelete && (
              <Btn
                variant="danger"
                size="sm"
                icon="trash"
                aria-label="Delete task"
                title="Delete task"
                onClick={(e) => {
                  e.stopPropagation();
                  setConfirmOpen(true);
                }}
                tabIndex={showDeleteAction ? 0 : -1}
                style={{
                  width: 34,
                  padding: 0,
                  opacity: showDeleteAction ? 1 : 0,
                  pointerEvents: showDeleteAction ? "auto" : "none",
                  position: "relative",
                  zIndex: 1,
                }}
              />
            )}
          </div>
        </div>
        {task.preview && (
          <div
            style={{
              fontFamily: "var(--mono)",
              fontSize: 11,
              color: "var(--text-dim)",
              background: "var(--surface-0)",
              border: "1px solid var(--border)",
              borderRadius: 6,
              padding: "8px 10px",
              lineHeight: 1.45,
            }}
          >
            {task.preview}
            {isRunning && (
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
        )}
        {menu && onDelete && (
          <div
            role="menu"
            aria-label="Task actions"
            onClick={(e) => e.stopPropagation()}
            style={{
              position: "fixed",
              top: menu.y,
              left: menu.x,
              zIndex: 1000,
              background: "var(--surface-2)",
              border: "1px solid var(--border)",
              borderRadius: 6,
              padding: 4,
              minWidth: 140,
              boxShadow: "0 6px 20px rgba(0,0,0,0.4)",
              pointerEvents: "auto",
            }}
          >
            <button
              role="menuitem"
              autoFocus
              onClick={(e) => {
                e.stopPropagation();
                setMenu(null);
                setConfirmOpen(true);
              }}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                width: "100%",
                padding: "7px 10px",
                background: "transparent",
                border: 0,
                borderRadius: 4,
                cursor: "pointer",
                color: "var(--status-needs, #e06c75)",
                fontSize: 12,
                fontFamily: "var(--mono)",
                textAlign: "left",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surface-3)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            >
              <Icon name="trash" size={12} /> Delete
            </button>
          </div>
        )}
        {(task.status === "needs-input" || task.status === "interrupted") && (
          <div style={{ position: "relative", zIndex: 1 }}>
            <Btn
              size="sm"
              variant="accent"
              icon="terminal"
              onClick={(e) => {
                e.stopPropagation();
                toggleTask();
              }}
              style={{ pointerEvents: "auto", position: "relative", zIndex: 1 }}
            >
              Open terminal to reply
            </Btn>
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
