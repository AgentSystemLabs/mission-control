import { STATUS_META } from "~/lib/design-meta";
import type { TaskStatus } from "~/shared/domain";

export function StatusDot({ status, size = 6 }: { status: TaskStatus; size?: number }) {
  const meta = STATUS_META[status];
  if (!meta || !meta.dot) return null;
  return (
    <span
      style={{
        display: "inline-block",
        width: size,
        height: size,
        borderRadius: "50%",
        background: meta.color,
        boxShadow: status === "running" ? `0 0 8px ${meta.color}` : "none",
        animation: status === "running" ? "pulse-dot 1.6s ease-in-out infinite" : "none",
        flexShrink: 0,
      }}
    />
  );
}

export function StatusPill({ status, count }: { status: TaskStatus; count?: number }) {
  const meta = STATUS_META[status];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "2px 8px 2px 7px",
        borderRadius: 999,
        background: "var(--surface-2)",
        border: "1px solid var(--border)",
        fontFamily: "var(--mono)",
        fontSize: 11,
        color: "var(--text-dim)",
        lineHeight: 1.4,
      }}
    >
      <StatusDot status={status} />
      {count != null && (
        <span style={{ color: "var(--text)", fontVariantNumeric: "tabular-nums" }}>{count}</span>
      )}
      <span>{meta.label.toLowerCase()}</span>
    </span>
  );
}
