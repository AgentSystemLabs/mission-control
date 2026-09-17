import { getSetting, setSetting } from "./settings";
import { DEFAULT_BINDINGS } from "~/lib/keybindings/defaults";
import {
  DEFAULT_KEYBINDINGS_SCOPE as DEFAULT_SCOPE,
  keybindingsSettingKey,
  parseBindingOverrides,
} from "~/lib/keybindings/overrides";
import type { Binding, BindingMap, HotkeyAction } from "~/lib/keybindings/types";

function readOverrides(scope: string): Partial<BindingMap> {
  return parseBindingOverrides(getSetting(keybindingsSettingKey(scope)));
}

function writeOverrides(scope: string, overrides: Partial<BindingMap>): void {
  setSetting(keybindingsSettingKey(scope), JSON.stringify(overrides));
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
