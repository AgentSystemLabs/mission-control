import type { ReactNode } from "react";
import { Icon, type IconName } from "./Icon";

export function Section({
  label,
  count,
  icon,
  dot,
  divider = true,
  marginBottom = 32,
  labelSize = 11,
  collapsible = false,
  collapsed = false,
  onToggleCollapsed,
  children,
}: {
  label: string;
  count: number;
  icon?: IconName;
  dot?: string;
  divider?: boolean;
  marginBottom?: number;
  labelSize?: number;
  collapsible?: boolean;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
  children: ReactNode;
}) {
  return (
    <div style={{ marginBottom: collapsible && collapsed ? Math.min(marginBottom, 20) : marginBottom }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: collapsible && collapsed ? 0 : 14,
          paddingBottom: divider ? 8 : 0,
          borderBottom: divider ? "1px solid var(--border)" : undefined,
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
        {icon && <Icon name={icon} size={12} style={{ color: "var(--accent-ink)" }} />}
        <span
          style={{
            fontFamily: "var(--mono)",
            fontSize: labelSize,
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
            fontSize: Math.max(11, labelSize - 1),
            color: "var(--text-faint)",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {count}
        </span>
        {collapsible && (
          <button
            type="button"
            onClick={onToggleCollapsed}
            aria-expanded={!collapsed}
            aria-label={collapsed ? `Expand ${label}` : `Collapse ${label}`}
            title={collapsed ? "Expand section" : "Collapse section"}
            style={{
              marginLeft: "auto",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: 22,
              height: 22,
              padding: 0,
              background: "transparent",
              border: 0,
              borderRadius: 5,
              color: "var(--text-faint)",
              cursor: "pointer",
            }}
          >
            <Icon
              name="chevron-down"
              size={12}
              style={{
                transform: collapsed ? "rotate(-90deg)" : undefined,
                transition: "transform 120ms ease",
              }}
            />
          </button>
        )}
      </div>
      {(!collapsible || !collapsed) && children}
    </div>
  );
}
