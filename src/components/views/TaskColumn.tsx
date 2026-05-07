import type React from "react";
import type { Task } from "~/db/schema";
import { TaskCard } from "./TaskCard";
import { taskGridCols, type TaskDensity } from "~/lib/use-task-density";

export function TaskColumn({
  title,
  color,
  tasks,
  activeId,
  density = "regular",
  onToggle,
  onDelete,
  headerAction,
}: {
  title: string;
  color: string;
  tasks: Task[];
  activeId: string | null;
  density?: TaskDensity;
  onToggle: (id: string) => void;
  onDelete?: (id: string) => void;
  headerAction?: React.ReactNode;
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
        {headerAction}
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: taskGridCols(density),
          gap: 12,
        }}
      >
        {tasks.map((t) => (
          <TaskCard
            key={t.id}
            task={t}
            selected={activeId === t.id}
            onToggle={onToggle}
            onDelete={onDelete}
          />
        ))}
      </div>
    </div>
  );
}
