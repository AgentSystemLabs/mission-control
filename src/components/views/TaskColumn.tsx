import type { Task } from "~/db/schema";
import { TaskCard } from "./TaskCard";

export function TaskColumn({
  title,
  color,
  tasks,
  activeId,
  onToggle,
  onArchive,
  onDelete,
}: {
  title: string;
  color: string;
  tasks: Task[];
  activeId: string | null;
  onToggle: (id: string) => void;
  onArchive: (id: string) => void;
  onDelete?: (id: string) => void;
}) {
  if (tasks.length === 0) return null;
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
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
            onDelete={onDelete}
          />
        ))}
      </div>
    </div>
  );
}
