import type { ButtonHTMLAttributes, CSSProperties, ReactNode } from "react";
import { Icon, type IconName } from "./Icon";

type Variant = "ghost" | "solid" | "accent" | "primary" | "danger";
type Size = "sm" | "md" | "lg";

type BtnProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "size"> & {
  variant?: Variant;
  size?: Size;
  icon?: IconName;
  children?: ReactNode;
};

const VARIANT_STYLES: Record<Variant, CSSProperties> = {
  ghost: { background: "transparent", border: "1px solid var(--border)", color: "var(--text-dim)" },
  solid: {
    background: "var(--surface-2)",
    border: "1px solid var(--border-strong)",
    color: "var(--text)",
  },
  accent: {
    background: "var(--accent-dim)",
    border: "1px solid var(--accent)",
    color: "var(--accent)",
  },
  primary: { background: "var(--accent)", border: "1px solid var(--accent)", color: "#0a0b0d" },
  danger: { background: "transparent", border: "1px solid var(--border)", color: "var(--status-failed)" },
};

const SIZE_STYLES: Record<Size, CSSProperties> = {
  sm: { height: 24, padding: "0 8px", fontSize: 11, gap: 5 },
  md: { height: 30, padding: "0 12px", fontSize: 12.5, gap: 6 },
  lg: { height: 36, padding: "0 16px", fontSize: 13, gap: 7 },
};

const HOVER_BG: Record<Variant, string> = {
  primary: "oklch(0.87 0.17 145)",
  ghost: "var(--surface-1)",
  accent: "oklch(0.82 0.17 145 / 0.22)",
  solid: "var(--surface-3)",
  danger: "var(--surface-1)",
};

export function Btn({
  variant = "ghost",
  size = "md",
  icon,
  children,
  style,
  ...rest
}: BtnProps) {
  return (
    <button
      {...rest}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: 7,
        fontFamily: "var(--sans)",
        fontWeight: 500,
        cursor: "pointer",
        transition: "background 0.12s, border-color 0.12s, color 0.12s",
        whiteSpace: "nowrap",
        ...VARIANT_STYLES[variant],
        ...SIZE_STYLES[size],
        ...style,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = HOVER_BG[variant];
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = VARIANT_STYLES[variant].background as string;
      }}
    >
      {icon && <Icon name={icon} size={size === "sm" ? 11 : 13} />}
      {children}
    </button>
  );
}
