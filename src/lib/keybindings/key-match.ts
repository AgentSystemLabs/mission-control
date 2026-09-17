import type { Binding } from "./types";

// DOM-free binding matching. Shared by the renderer (KeyboardEvent) and the
// Electron main process (before-input-event), so nothing here may reference
// browser globals.

/** The key shape both a DOM KeyboardEvent and Electron's `Input` satisfy. */
export type KeyInput = { key: string; code?: string };

export function normalizeKey(key: string): string {
  if (key.length === 1) return key.toLowerCase();
  return key;
}

/** Whether the pressed key (ignoring modifiers) is the binding's key. */
export function keyMatchesBinding(input: KeyInput, b: Binding): boolean {
  const ek = normalizeKey(input.key);
  if (ek === b.key) return true;
  // Allow shifted symbol equivalents (e.g. binding "`" matches Shift+~ on US layouts).
  if (b.key === "`" && ek === "~") return true;
  // Bracket keys report shifted symbols on US layouts (e.g. Shift+] → "}").
  if (b.key === "]" && (ek === "}" || input.code === "BracketRight")) return true;
  if (b.key === "[" && (ek === "{" || input.code === "BracketLeft")) return true;
  return false;
}

export function bindingsEqual(a: Binding, b: Binding): boolean {
  return a.mod === b.mod && a.shift === b.shift && a.alt === b.alt && normalizeKey(a.key) === normalizeKey(b.key);
}

export function bindingComboKey(b: Binding): string {
  return `${b.mod ? "M" : ""}${b.shift ? "S" : ""}${b.alt ? "A" : ""}|${normalizeKey(b.key)}`;
}

export function isValidBinding(b: Binding): { ok: true } | { ok: false; reason: string } {
  if (!b.mod) return { ok: false, reason: "Binding must include Cmd/Ctrl." };
  if (!b.key) return { ok: false, reason: "Missing key." };
  if (b.key === "Meta" || b.key === "Control" || b.key === "Shift" || b.key === "Alt") {
    return { ok: false, reason: "Binding must include a non-modifier key." };
  }
  return { ok: true };
}
