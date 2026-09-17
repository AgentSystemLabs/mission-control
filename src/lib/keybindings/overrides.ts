import { HOTKEY_ACTIONS, type Binding, type BindingMap, type HotkeyAction } from "./types";

// User keybinding overrides live in the `app_settings` table as one JSON blob
// per scope. Both the server (HTTP API) and the Electron main process (native
// before-input-event matching) read that blob, so the key and the parse rules
// are defined once here. DOM-free on purpose: electron/tsconfig includes it.

/** Decoupled scope so adding per-user later is a one-line caller change. */
export const DEFAULT_KEYBINDINGS_SCOPE = "global";

export function keybindingsSettingKey(scope: string): string {
  return `keybindings:${scope}`;
}

export function isHotkeyAction(value: string): value is HotkeyAction {
  return (HOTKEY_ACTIONS as readonly string[]).includes(value);
}

export function isBinding(value: unknown): value is Binding {
  if (!value || typeof value !== "object") return false;
  const b = value as Record<string, unknown>;
  return (
    typeof b.mod === "boolean" &&
    typeof b.shift === "boolean" &&
    typeof b.alt === "boolean" &&
    typeof b.key === "string" &&
    b.key.length > 0
  );
}

/**
 * Parse a stored overrides blob, keeping only well-formed bindings for known
 * actions. Malformed JSON or a non-object yields no overrides.
 */
export function parseBindingOverrides(raw: string | null | undefined): Partial<BindingMap> {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    const overrides: Partial<BindingMap> = {};
    for (const [action, binding] of Object.entries(parsed)) {
      if (isHotkeyAction(action) && isBinding(binding)) overrides[action] = binding;
    }
    return overrides;
  } catch {
    return {};
  }
}
