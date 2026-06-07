import type { Binding } from "./types";
import { PINNED_SLOT_COUNT } from "./match";

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

export function formatBindingParts(b: Binding): string[] {
  const parts: string[] = [];
  if (b.mod) parts.push(isMac ? "⌘" : "Ctrl");
  if (b.alt) parts.push(isMac ? "⌥" : "Alt");
  if (b.shift) parts.push(isMac ? "⇧" : "Shift");
  parts.push(formatKey(b.key));
  return parts;
}

export function formatBinding(b: Binding): string {
  return formatBindingParts(b).join(" + ");
}

/** Display pinned-slot bindings as e.g. ⌘ + 1–9. */
export function formatPinnedSlotBindingParts(base: Binding): string[] {
  const parts = formatBindingParts(base);
  const modParts = parts.slice(0, -1);
  return [...modParts, `1–${PINNED_SLOT_COUNT}`];
}

export function formatPinnedSlotBinding(base: Binding): string {
  return formatPinnedSlotBindingParts(base).join(" + ");
}
