import type { Binding } from "./types";

const isMac = typeof navigator !== "undefined" && /Mac/i.test(navigator.platform);

const KEY_GLYPH: Record<string, string> = {
  Enter: "↵",
  enter: "↵",
  ArrowUp: "↑",
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
  Escape: "Esc",
  Tab: "⇥",
  " ": "Space",
};

function formatKey(key: string): string {
  if (KEY_GLYPH[key]) return KEY_GLYPH[key];
  if (key.length === 1) return key.toUpperCase();
  return key;
}

export function formatBinding(b: Binding): string {
  const parts: string[] = [];
  if (b.mod) parts.push(isMac ? "⌘" : "Ctrl");
  if (b.alt) parts.push(isMac ? "⌥" : "Alt");
  if (b.shift) parts.push(isMac ? "⇧" : "Shift");
  parts.push(formatKey(b.key));
  return isMac ? parts.join("") : parts.join("+");
}
