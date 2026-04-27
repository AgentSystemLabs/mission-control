import { useEffect, useRef } from "react";
import type { HotkeyCombo } from "~/components/ui/Kbd";

export function matchHotkey(e: KeyboardEvent, combo: HotkeyCombo): boolean {
  const mod = e.metaKey || e.ctrlKey;
  // All `mod+*` combos require *only* the mod key — no Shift/Alt — so muscle
  // memory like Cmd+Shift+P (browser command palette) doesn't trigger our
  // bindings. ctrl+` accepts Shift since `~` requires it on US layouts.
  const plain = !e.shiftKey && !e.altKey;
  switch (combo) {
    case "mod+enter":
      return mod && plain && e.key === "Enter";
    case "mod+n":
      return mod && plain && (e.key === "n" || e.key === "N");
    case "mod+p":
      return mod && plain && (e.key === "p" || e.key === "P");
    case "mod+m":
      return mod && plain && (e.key === "m" || e.key === "M");
    case "mod+/":
      return mod && plain && e.key === "/";
    case "mod+.":
      return mod && plain && e.key === ".";
    case "mod+l":
      return mod && plain && (e.key === "l" || e.key === "L");
    case "ctrl+`":
      return mod && !e.altKey && (e.key === "`" || e.key === "~");
    case "enter":
      return plain && !mod && e.key === "Enter";
    case "escape":
      return e.key === "Escape";
  }
}

export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return target.isContentEditable;
}

export type HotkeyOptions = {
  enabled?: boolean;
  ignoreEditable?: boolean;
  preventDefault?: boolean;
};

export function useHotkey(
  combo: HotkeyCombo,
  handler: (e: KeyboardEvent) => void,
  options: HotkeyOptions = {},
) {
  const { enabled = true, ignoreEditable = false, preventDefault = true } = options;
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (!matchHotkey(e, combo)) return;
      if (ignoreEditable && isEditableTarget(e.target)) return;
      if (preventDefault) e.preventDefault();
      handlerRef.current(e);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [combo, enabled, ignoreEditable, preventDefault]);
}
