import { useEffect, useState } from "react";
import { Icon } from "~/components/ui/Icon";
import { ShimmerBar } from "~/components/ui/ShimmerBar";
import { StatusDot } from "~/components/ui/StatusDot";
import { Btn } from "~/components/ui/Btn";
import { Modal } from "~/components/ui/Modal";
import { Kbd } from "~/components/ui/Kbd";
import { AgentGlyph } from "~/components/ui/AgentGlyph";
import { useHotkey } from "~/lib/use-hotkey";
import { useCardGlow } from "~/lib/use-card-glow";
import { AGENT_META, STATUS_META } from "~/lib/design-meta";
import { isSentinelTitle } from "~/lib/task-sentinels";
import type { Task } from "~/db/schema";

export function TaskCard({
  task,
  selected,
  onToggle,
  onArchive,
  onDelete,
}: {
  task: Task;
  selected: boolean;
  onToggle: (taskId: string) => void;
  onArchive: (taskId: string) => void;
  onDelete?: (taskId: string) => void;
}) {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [hovered, setHovered] = useState(false);
  const glowRef = useCardGlow<HTMLDivElement>();

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("click", close);
    window.addEventListener("scroll", close, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [menu]);

  useHotkey(
    "enter",
    (e) => {
      e.stopPropagation();
      e.preventDefault();
      if (onDelete) onDelete(task.id);
      setConfirmOpen(false);
    },
    { enabled: confirmOpen },
  );
  const meta = AGENT_META[task.agent];
  const statusMeta = STATUS_META[task.status];
  const isRunning = task.status === "running";

  const updated = formatRelative(task.updatedAt);

  return (
    <div
      ref={glowRef}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (onDelete) setMenu({ x: e.clientX, y: e.clientY });
      }}
      style={{
        background: selected ? "var(--surface-2)" : "var(--surface-1)",
        border: `1px solid ${selected ? "var(--accent)" : "var(--border)"}`,
        borderRadius: 10,
        overflow: "hidden",
        cursor: "pointer",
        transition: "all 0.15s",
        position: "relative",
        boxShadow: selected ? "0 0 0 1px var(--accent), 0 0 16px var(--accent-faint)" : "none",
      }}
      onMouseEnter={(e) => {
        setHovered(true);
        if (!selected) e.currentTarget.style.borderColor = "var(--border-strong)";
      }}
      onMouseLeave={(e) => {
        setHovered(false);
        if (!selected) e.currentTarget.style.borderColor = "var(--border)";
      }}
    >
      <button
        type="button"
        onClick={() => onToggle(task.id)}
        aria-label={`${selected ? "Close" : "Open"} terminal for ${task.title}`}
        aria-pressed={selected}
        style={{
          position: "absolute",
          inset: 0,
          zIndex: 0,
          background: "transparent",
          border: 0,
          padding: 0,
          margin: 0,
          cursor: "pointer",
          borderRadius: "inherit",
        }}
      />
      <ShimmerBar active={isRunning} color={meta?.color} />
      <div style={{ padding: 14, display: "flex", flexDirection: "column", gap: 10, position: "relative", zIndex: 1, pointerEvents: "none" }}>
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
              <span>+{task.lines} lines</span>
              <span>·</span>
              <span>{updated}</span>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {onDelete && (
              <button
                aria-label="Delete task"
                title="Delete task"
                onClick={(e) => {
                  e.stopPropagation();
                  setConfirmOpen(true);
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 20,
                  height: 20,
                  border: 0,
                  borderRadius: 4,
                  background: "transparent",
                  color: "var(--text-faint)",
                  cursor: "pointer",
                  opacity: hovered ? 1 : 0,
                  pointerEvents: hovered ? "auto" : "none",
                  transition: "opacity 0.12s, color 0.12s, background 0.12s",
                  position: "relative",
                  zIndex: 1,
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.color = "var(--status-failed)";
                  e.currentTarget.style.background = "var(--surface-2)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.color = "var(--text-faint)";
                  e.currentTarget.style.background = "transparent";
                }}
              >
                <Icon name="trash" size={12} />
              </button>
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
        {task.status === "finished" && (
          <div style={{ display: "flex", gap: 6, position: "relative", zIndex: 1, pointerEvents: "auto" }}>
            <Btn
              size="sm"
              variant="ghost"
              icon="archive"
              onClick={(e) => {
                e.stopPropagation();
                onArchive(task.id);
              }}
            >
              Archive
            </Btn>
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
        {task.status === "needs-input" && (
          <div style={{ position: "relative", zIndex: 1, pointerEvents: "auto" }}>
            <Btn
              size="sm"
              variant="accent"
              icon="terminal"
              onClick={(e) => {
                e.stopPropagation();
                onToggle(task.id);
              }}
            >
              Open terminal to reply
            </Btn>
          </div>
        )}
      </div>
      {onDelete && (
        <div onClick={(e) => e.stopPropagation()}>
        <Modal
          open={confirmOpen}
          onClose={() => setConfirmOpen(false)}
          title="Delete task"
          width={420}
          footer={
            <>
              <Btn variant="ghost" onClick={() => setConfirmOpen(false)}>
                Cancel <Kbd variant="inline">Esc</Kbd>
              </Btn>
              <Btn
                variant="danger"
                icon="trash"
                onClick={() => {
                  onDelete(task.id);
                  setConfirmOpen(false);
                }}
              >
                Delete <Kbd variant="inline">Enter</Kbd>
              </Btn>
            </>
          }
        >
          <div style={{ fontSize: 13, color: "var(--text)", marginBottom: 6 }}>
            Delete &ldquo;{task.title}&rdquo;?
          </div>
          <div style={{ fontSize: 12, color: "var(--text-dim)" }}>
            This task and its worktree will be removed. This cannot be undone.
          </div>
        </Modal>
        </div>
      )}
    </div>
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
