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

function keyMatches(e: KeyboardEvent, b: Binding): boolean {
  const ek = normalizeKey(e.key);
  if (ek === b.key) return true;
  // Allow shifted symbol equivalents (e.g. binding "`" matches Shift+~ on US layouts).
  if (b.key === "`" && ek === "~") return true;
  // Bracket keys report shifted symbols on US layouts (e.g. Shift+] → "}").
  if (b.key === "]" && (ek === "}" || e.code === "BracketRight")) return true;
  if (b.key === "[" && (ek === "{" || e.code === "BracketLeft")) return true;
  return false;
}

export function matchBinding(e: KeyboardEvent, b: Binding): boolean {
  const mod = e.metaKey || e.ctrlKey;
  if (mod !== b.mod) return false;
  if (e.shiftKey !== b.shift) return false;
  if (e.altKey !== b.alt) return false;
  return keyMatches(e, b);
}

/** Number of pinned-project slots that get a number badge + Cmd+N shortcut. */
export const PINNED_SLOT_COUNT = 9;

/** Match pinned-project slots that share modifiers with the slot-1 binding. */
export function matchPinnedSlotBinding(e: KeyboardEvent, base: Binding, slot: number): boolean {
  if (slot < 1 || slot > PINNED_SLOT_COUNT) return false;
  return matchBinding(e, { ...base, key: String(slot) });
}

export function matchAnyPinnedSlot(e: KeyboardEvent, base: Binding): number | null {
  for (let slot = 1; slot <= PINNED_SLOT_COUNT; slot += 1) {
    if (matchPinnedSlotBinding(e, base, slot)) return slot;
  }
  return null;
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
