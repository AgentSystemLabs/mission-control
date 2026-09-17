import { DEFAULT_BINDINGS } from "../src/lib/keybindings/defaults";
import { keyMatchesBinding } from "../src/lib/keybindings/key-match";
import {
  DEFAULT_KEYBINDINGS_SCOPE,
  keybindingsSettingKey,
  parseBindingOverrides,
} from "../src/lib/keybindings/overrides";
import type { Binding, BindingMap, HotkeyAction } from "../src/lib/keybindings/types";
import { getStringAppSetting } from "./app-settings-store";

function readOverrides(userDataDir: string): Partial<BindingMap> {
  return parseBindingOverrides(
    getStringAppSetting(userDataDir, keybindingsSettingKey(DEFAULT_KEYBINDINGS_SCOPE)),
  );
}

export function getBinding(userDataDir: string, action: HotkeyAction): Binding {
  const overrides = readOverrides(userDataDir);
  return overrides[action] ?? DEFAULT_BINDINGS[action];
}

type ElectronKeyInput = {
  type: string;
  key: string;
  code?: string;
  meta?: boolean;
  control?: boolean;
  shift?: boolean;
  alt?: boolean;
};

export function matchElectronInput(input: ElectronKeyInput, b: Binding): boolean {
  if (input.type !== "keyDown") return false;
  const mod = process.platform === "darwin" ? !!input.meta : !!input.control;
  if (mod !== b.mod) return false;
  if (!!input.shift !== b.shift) return false;
  if (!!input.alt !== b.alt) return false;
  return keyMatchesBinding(input, b);
}
