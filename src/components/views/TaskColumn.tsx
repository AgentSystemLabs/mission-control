import type React from "react";
import type { Task } from "~/db/schema";
import { TaskCard } from "./TaskCard";

export function TaskColumn({
  title,
  color,
  tasks,
  activeId,
  onToggle,
  onArchive,
  onRestore,
  onDelete,
  onRename,
  headerAction,
}: {
  title: string;
  color: string;
  tasks: Task[];
  activeId: string | null;
  onToggle: (id: string) => void;
  onArchive?: (id: string) => void;
  onRestore?: (id: string) => void;
  onDelete?: (id: string) => void;
  onRename?: (id: string, title: string) => Promise<void> | void;
  headerAction?: React.ReactNode;
}) {
  if (tasks.length === 0) return null;
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 18 }}>
        <span
          style={{
            width: 7,
            height: 7,
            borderRadius: "50%",
            background: color,
            boxShadow: `0 0 6px ${color}66`,
          }}
        />
        <span
          style={{
            fontFamily: "var(--mono)",
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "var(--text)",
          }}
        >
          {title}
        </span>
        <span
          style={{
            fontFamily: "var(--mono)",
            fontSize: 11,
            color: "var(--text-faint)",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {tasks.length}
        </span>
        {headerAction && <div style={{ marginLeft: "auto" }}>{headerAction}</div>}
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(360px, 1fr))",
          gap: 12,
        }}
      >
        {tasks.map((t) => (
          <TaskCard
            key={t.id}
            task={t}
            selected={activeId === t.id}
            onToggle={onToggle}
            onArchive={onArchive}
            onRestore={onRestore}
            onDelete={onDelete}
            onRename={onRename}
          />
        ))}
      </div>
    </div>
  );
}
