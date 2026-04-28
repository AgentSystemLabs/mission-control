import type { CSSProperties, ReactNode } from "react";
import { useFormattedBinding } from "~/lib/keybindings/store";
import type { HotkeyAction } from "~/lib/keybindings/types";

export type KbdVariant = "onPrimary" | "ghost" | "inline";

const BASE: CSSProperties = {
  fontFamily: "var(--mono)",
  padding: "1px 5px",
};

const VARIANT_STYLE: Record<KbdVariant, CSSProperties> = {
  onPrimary: {
    marginLeft: 6,
    borderRadius: 4,
    background: "rgba(0,0,0,0.18)",
    fontSize: 10.5,
    fontWeight: 500,
    lineHeight: 1.4,
  },
  ghost: {
    marginLeft: 6,
    fontSize: 10,
    color: "var(--text-faint)",
    border: "1px solid var(--border)",
    borderRadius: 3,
    background: "var(--surface-1)",
  },
  inline: {
    fontSize: 11,
    border: "1px solid var(--border)",
    borderRadius: 3,
    background: "var(--surface-0)",
  },
};

export function Kbd({
  variant = "ghost",
  children,
  style,
}: {
  variant?: KbdVariant;
  children: ReactNode;
  style?: CSSProperties;
}) {
  return <kbd style={{ ...BASE, ...VARIANT_STYLE[variant], ...style }}>{children}</kbd>;
}

/** Render the user's current binding for an action. */
export function KbdAction({
  action,
  variant = "ghost",
  style,
}: {
  action: HotkeyAction;
  variant?: KbdVariant;
  style?: CSSProperties;
}) {
  const label = useFormattedBinding(action);
  return <Kbd variant={variant} style={style}>{label}</Kbd>;
}
