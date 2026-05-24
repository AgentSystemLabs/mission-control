import { Fragment, type CSSProperties, type ReactNode } from "react";
import { formatBindingParts } from "~/lib/keybindings/format";
import { useBinding } from "~/lib/keybindings/store";
import type { Binding, HotkeyAction } from "~/lib/keybindings/types";

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

const COMBO_KEY_SIZE: Record<"default" | "lg", CSSProperties> = {
  default: {
    fontSize: 10,
    padding: "2px 6px",
    minWidth: 22,
    minHeight: 22,
  },
  lg: {
    fontSize: 14,
    padding: "6px 10px",
    minWidth: 36,
    minHeight: 36,
  },
};

const COMBO_SEP_SIZE: Record<"default" | "lg", CSSProperties> = {
  default: { fontSize: 10 },
  lg: { fontSize: 14, fontWeight: 500 },
};

/** Render each key in a binding as its own kbd chip, separated by +. */
export function KbdCombo({
  binding,
  parts,
  variant = "ghost",
  size = "default",
  style,
}: {
  binding?: Binding;
  parts?: string[];
  variant?: KbdVariant;
  size?: "default" | "lg";
  style?: CSSProperties;
}) {
  const keys = parts ?? (binding ? formatBindingParts(binding) : []);
  const gap = size === "lg" ? 6 : 4;

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap,
        ...style,
      }}
      aria-label={keys.join(" + ")}
    >
      {keys.map((key, i) => (
        <Fragment key={`${key}-${i}`}>
          {i > 0 && (
            <span
              style={{
                ...COMBO_SEP_SIZE[size],
                color: "var(--text-faint)",
                userSelect: "none",
                lineHeight: 1,
              }}
              aria-hidden
            >
              +
            </span>
          )}
          <kbd
            style={{
              ...BASE,
              ...VARIANT_STYLE[variant],
              ...COMBO_KEY_SIZE[size],
              marginLeft: 0,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              textAlign: "center",
              lineHeight: 1,
            }}
          >
            {key}
          </kbd>
        </Fragment>
      ))}
    </span>
  );
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
  const binding = useBinding(action);
  return <KbdCombo binding={binding} variant={variant} style={style} />;
}
