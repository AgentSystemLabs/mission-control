import type { ReactNode } from "react";
import { Icon, type IconName } from "./Icon";
import { useCardGlow } from "~/lib/use-card-glow";

export function EmptyState({
  title,
  subtitle,
  action,
  icon = "sparkles",
}: {
  title: string;
  subtitle: string;
  action?: ReactNode;
  icon?: IconName;
}) {
  const glowRef = useCardGlow<HTMLDivElement>();
  return (
    <div
      ref={glowRef}
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: "60px 20px",
        gap: 14,
        border: "1px dashed var(--border-strong)",
        borderRadius: 12,
        background: "var(--surface-0)",
        position: "relative",
      }}
    >
      <div
        style={{
          width: 44,
          height: 44,
          borderRadius: 10,
          background: "var(--surface-2)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--text-dim)",
        }}
      >
        <Icon name={icon} size={20} />
      </div>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>{title}</div>
        <div style={{ fontSize: 13, color: "var(--text-dim)", fontFamily: "var(--mono)" }}>
          {subtitle}
        </div>
      </div>
      {action}
    </div>
  );
}
