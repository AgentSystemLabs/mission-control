import { DEFAULT_BINDINGS } from "~/lib/keybindings/defaults";
import { HOTKEY_ACTIONS, type Binding, type BindingMap, type HotkeyAction } from "~/lib/keybindings/types";
import { getSetting, setSetting } from "./settings";
import type { UserScope } from "../repositories";

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

async function readOverrides(scopeName: string, scope?: UserScope): Promise<Partial<BindingMap>> {
  const raw = await getSetting(settingKey(scopeName), scope);
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

async function writeOverrides(
  scopeName: string,
  overrides: Partial<BindingMap>,
  scope?: UserScope,
): Promise<void> {
  await setSetting(settingKey(scopeName), JSON.stringify(overrides), scope);
}

export async function getBindings(scopeName: string = DEFAULT_SCOPE, scope?: UserScope): Promise<BindingMap> {
  const overrides = await readOverrides(scopeName, scope);
  return { ...DEFAULT_BINDINGS, ...overrides };
}

export async function setBinding(
  action: HotkeyAction,
  binding: Binding,
  scopeName: string = DEFAULT_SCOPE,
  scope?: UserScope,
): Promise<BindingMap> {
  const overrides = await readOverrides(scopeName, scope);
  overrides[action] = binding;
  await writeOverrides(scopeName, overrides, scope);
  return { ...DEFAULT_BINDINGS, ...overrides };
}

export async function resetBinding(
  action: HotkeyAction,
  scopeName: string = DEFAULT_SCOPE,
  scope?: UserScope,
): Promise<BindingMap> {
  const overrides = await readOverrides(scopeName, scope);
  delete overrides[action];
  await writeOverrides(scopeName, overrides, scope);
  return { ...DEFAULT_BINDINGS, ...overrides };
}

export async function resetAllBindings(scopeName: string = DEFAULT_SCOPE, scope?: UserScope): Promise<BindingMap> {
  await writeOverrides(scopeName, {}, scope);
  return { ...DEFAULT_BINDINGS };
}
