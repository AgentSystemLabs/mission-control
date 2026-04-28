import type { Binding } from "./types";

function normalizeKey(key: string): string {
  if (key.length === 1) return key.toLowerCase();
  return key;
}

export function eventToBinding(e: KeyboardEvent): Binding | null {
  const key = e.key;
  if (key === "Meta" || key === "Control" || key === "Shift" || key === "Alt") return null;
  return {
    mod: e.metaKey || e.ctrlKey,
    shift: e.shiftKey,
    alt: e.altKey,
    key: normalizeKey(key),
  };
}

export function matchBinding(e: KeyboardEvent, b: Binding): boolean {
  const mod = e.metaKey || e.ctrlKey;
  if (mod !== b.mod) return false;
  if (e.shiftKey !== b.shift) return false;
  if (e.altKey !== b.alt) return false;
  const ek = normalizeKey(e.key);
  // Allow shifted symbol equivalents (e.g. binding "`" matches Shift+~ on US layouts).
  if (ek === b.key) return true;
  if (b.key === "`" && ek === "~") return true;
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
