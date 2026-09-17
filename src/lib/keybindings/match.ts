import type { Binding } from "./types";
import { keyMatchesBinding, normalizeKey } from "./key-match";

export { bindingComboKey, bindingsEqual, isValidBinding, normalizeKey } from "./key-match";

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
  return keyMatchesBinding(e, b);
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
