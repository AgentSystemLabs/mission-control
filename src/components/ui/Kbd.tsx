import type { CSSProperties, ReactNode } from "react";

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

const isMac = typeof navigator !== "undefined" && /Mac/i.test(navigator.platform);

export type HotkeyCombo =
  | "mod+enter"
  | "mod+n"
  | "mod+e"
  | "mod+p"
  | "mod+m"
  | "mod+/"
  | "mod+."
  | "mod+l"
  | "ctrl+`"
  | "enter"
  | "escape";

export function hotkeyLabel(combo: HotkeyCombo): string {
  switch (combo) {
    case "mod+enter":
      return isMac ? "⌘↵" : "Ctrl+↵";
    case "mod+n":
      return isMac ? "⌘N" : "Ctrl+N";
    case "mod+e":
      return isMac ? "⌘E" : "Ctrl+E";
    case "mod+p":
      return isMac ? "⌘P" : "Ctrl+P";
    case "mod+m":
      return isMac ? "⌘M" : "Ctrl+M";
    case "mod+/":
      return isMac ? "⌘/" : "Ctrl+/";
    case "mod+.":
      return isMac ? "⌘." : "Ctrl+.";
    case "mod+l":
      return isMac ? "⌘L" : "Ctrl+L";
    case "ctrl+`":
      return "⌃~";
    case "enter":
      return "↵";
    case "escape":
      return "Esc";
  }
}

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
