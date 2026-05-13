import { getSetting, setSetting } from "./settings";
import { DEFAULT_BINDINGS } from "~/lib/keybindings/defaults";
import { HOTKEY_ACTIONS, type Binding, type BindingMap, type HotkeyAction } from "~/lib/keybindings/types";

// Decoupled scope so adding per-user later is a one-line caller change.
const DEFAULT_SCOPE = "global";
const settingKey = (scope: string) => `keybindings:${scope}`;

function isHotkeyAction(s: string): s is HotkeyAction {
  return (HOTKEY_ACTIONS as readonly string[]).includes(s);
}

function isBinding(v: unknown): v is Binding {
  if (!v || typeof v !== "object") return false;
  const b = v as Record<string, unknown>;
  return (
    typeof b.mod === "boolean" &&
    typeof b.shift === "boolean" &&
    typeof b.alt === "boolean" &&
    typeof b.key === "string" &&
    b.key.length > 0
  );
}

function readOverrides(scope: string): Partial<BindingMap> {
  const raw = getSetting(settingKey(scope));
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    const out: Partial<BindingMap> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (isHotkeyAction(k) && isBinding(v)) out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

function writeOverrides(scope: string, overrides: Partial<BindingMap>): void {
  setSetting(settingKey(scope), JSON.stringify(overrides));
}

export function getBindings(scope: string = DEFAULT_SCOPE): BindingMap {
  const overrides = readOverrides(scope);
  return { ...DEFAULT_BINDINGS, ...overrides };
}

export function setBinding(action: HotkeyAction, binding: Binding, scope: string = DEFAULT_SCOPE): BindingMap {
  const overrides = readOverrides(scope);
  overrides[action] = binding;
  writeOverrides(scope, overrides);
  return { ...DEFAULT_BINDINGS, ...overrides };
}

export function resetBinding(action: HotkeyAction, scope: string = DEFAULT_SCOPE): BindingMap {
  const overrides = readOverrides(scope);
  delete overrides[action];
  writeOverrides(scope, overrides);
  return { ...DEFAULT_BINDINGS, ...overrides };
}

export function resetAllBindings(scope: string = DEFAULT_SCOPE): BindingMap {
  writeOverrides(scope, {});
  return { ...DEFAULT_BINDINGS };
}
