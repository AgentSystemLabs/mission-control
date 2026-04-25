import type { ReactNode } from "react";
import { Icon, type IconName } from "./Icon";

export function Section({
  label,
  count,
  icon,
  dot,
  children,
}: {
  label: string;
  count: number;
  icon?: IconName;
  dot?: string;
  children: ReactNode;
}) {
  return (
    <div style={{ marginBottom: 32 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 14,
          paddingBottom: 8,
          borderBottom: "1px solid var(--border)",
        }}
      >
        {dot && (
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: "50%",
              background: dot,
              boxShadow: `0 0 6px ${dot}66`,
            }}
          />
        )}
        {icon && <Icon name={icon} size={12} style={{ color: "var(--accent)" }} />}
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
          {label}
        </span>
        <span
          style={{
            fontFamily: "var(--mono)",
            fontSize: 11,
            color: "var(--text-faint)",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {count}
        </span>
      </div>
      {children}
    </div>
  );
}
