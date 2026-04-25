import { useEffect, useState } from "react";
import { Icon } from "~/components/ui/Icon";
import { ShimmerBar } from "~/components/ui/ShimmerBar";
import { StatusDot } from "~/components/ui/StatusDot";
import { Btn } from "~/components/ui/Btn";
import { AgentGlyph } from "~/components/ui/AgentGlyph";
import { AGENT_META, STATUS_META } from "~/lib/design-meta";
import type { Task } from "~/db/schema";

export function TaskCard({
  task,
  selected,
  onToggle,
  onArchive,
  onCommitPush,
  onDelete,
}: {
  task: Task;
  selected: boolean;
  onToggle: (taskId: string) => void;
  onArchive: (taskId: string) => void;
  onCommitPush?: (taskId: string) => void;
  onDelete?: (taskId: string) => void;
}) {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener("click", close);
    window.addEventListener("scroll", close, true);
    window.addEventListener("keydown", (e) => e.key === "Escape" && close());
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [menu]);
  const meta = AGENT_META[task.agent];
  const statusMeta = STATUS_META[task.status];
  const isRunning = task.status === "running";

  const updated = formatRelative(task.updatedAt);

  return (
    <div
      onClick={() => onToggle(task.id)}
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
        if (!selected) e.currentTarget.style.borderColor = "var(--border-strong)";
      }}
      onMouseLeave={(e) => {
        if (!selected) e.currentTarget.style.borderColor = "var(--border)";
      }}
    >
      <ShimmerBar active={isRunning} color={meta?.color} />
      <div style={{ padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
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
            <div
              style={{
                fontSize: 13.5,
                fontWeight: 500,
                lineHeight: 1.35,
                color: "var(--text)",
                marginBottom: 4,
              }}
            >
              {task.title}
            </div>
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
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
            <div
              style={{
                width: 18,
                height: 18,
                borderRadius: 4,
                border: selected ? "1px solid var(--accent)" : "1px solid var(--border-strong)",
                background: selected ? "var(--accent)" : "transparent",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#0a0b0d",
              }}
            >
              {selected && <Icon name="check" size={11} />}
            </div>
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
        {task.status === "done" && (
          <div style={{ display: "flex", gap: 6 }}>
            {onCommitPush && (
              <Btn
                size="sm"
                variant="accent"
                icon="upload"
                onClick={(e) => {
                  e.stopPropagation();
                  onCommitPush(task.id);
                }}
              >
                Commit & push
              </Btn>
            )}
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
            }}
          >
            <button
              onClick={(e) => {
                e.stopPropagation();
                setMenu(null);
                onDelete(task.id);
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
        )}
      </div>
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
