import { DEFAULT_BINDINGS } from "../src/lib/keybindings/defaults";
import type { Binding, BindingMap, HotkeyAction } from "../src/lib/keybindings/types";
import { getStringAppSetting } from "./app-settings-store";

const KEYBINDINGS_SCOPE = "global";
const settingKey = (scope: string) => `keybindings:${scope}`;

function isHotkeyAction(s: string): s is HotkeyAction {
  return s in DEFAULT_BINDINGS;
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

function readOverrides(userDataDir: string): Partial<BindingMap> {
  const raw = getStringAppSetting(userDataDir, settingKey(KEYBINDINGS_SCOPE));
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
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

function normalizeKey(key: string): string {
  if (key.length === 1) return key.toLowerCase();
  return key;
}

function keyMatches(input: ElectronKeyInput, b: Binding): boolean {
  const ek = normalizeKey(input.key);
  if (ek === b.key) return true;
  if (b.key === "`" && ek === "~") return true;
  if (b.key === "]" && (ek === "}" || input.code === "BracketRight")) return true;
  if (b.key === "[" && (ek === "{" || input.code === "BracketLeft")) return true;
  return false;
}

export function matchElectronInput(input: ElectronKeyInput, b: Binding): boolean {
  if (input.type !== "keyDown") return false;
  const mod = process.platform === "darwin" ? !!input.meta : !!input.control;
  if (mod !== b.mod) return false;
  if (!!input.shift !== b.shift) return false;
  if (!!input.alt !== b.alt) return false;
  return keyMatches(input, b);
}
