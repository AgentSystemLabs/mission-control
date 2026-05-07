import type { CSSProperties, ReactNode } from "react";
import { Icon } from "./Icon";

export type BannerVariant = "info" | "warning" | "danger";

const VARIANT_STYLE: Record<
  BannerVariant,
  { bg: string; border: string; fg: string }
> = {
  info: {
    bg: "rgba(59, 130, 246, 0.10)",
    border: "rgba(59, 130, 246, 0.45)",
    fg: "var(--text)",
  },
  warning: {
    bg: "rgba(234, 179, 8, 0.12)",
    border: "rgba(234, 179, 8, 0.45)",
    fg: "var(--text)",
  },
  danger: {
    bg: "rgba(239, 68, 68, 0.12)",
    border: "rgba(239, 68, 68, 0.55)",
    fg: "var(--text)",
  },
};

export function Banner({
  variant = "info",
  children,
  action,
  onDismiss,
  style,
}: {
  variant?: BannerVariant;
  children: ReactNode;
  action?: ReactNode;
  onDismiss?: () => void;
  style?: CSSProperties;
}) {
  const v = VARIANT_STYLE[variant];
  return (
    <div
      role="alert"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "8px 16px",
        background: v.bg,
        borderBottom: `1px solid ${v.border}`,
        color: v.fg,
        fontSize: 12.5,
        fontFamily: "var(--mono)",
        ...style,
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>{children}</div>
      {action}
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss banner"
          style={{
            width: 24,
            height: 24,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: 4,
            border: "1px solid var(--border)",
            background: "transparent",
            color: "var(--text-dim)",
            cursor: "pointer",
            flexShrink: 0,
          }}
        >
          <Icon name="x" size={12} />
        </button>
      )}
    </div>
  );
}
