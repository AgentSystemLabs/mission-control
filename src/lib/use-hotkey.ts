import { useEffect, useRef } from "react";
import { matchBinding } from "~/lib/keybindings/match";
import { useKeybindings } from "~/lib/keybindings/store";
import { HOTKEY_ACTIONS, type HotkeyAction } from "~/lib/keybindings/types";
import { isSettingsOverlayOpen } from "~/lib/settings-navigation";

export type HotkeyTarget = HotkeyAction | "enter" | "mod+enter" | "escape";

function isAction(t: HotkeyTarget): t is HotkeyAction {
  return (HOTKEY_ACTIONS as readonly string[]).includes(t);
}

function matchLiteral(e: KeyboardEvent, t: "enter" | "mod+enter" | "escape"): boolean {
  if (t === "enter") {
    const mod = e.metaKey || e.ctrlKey;
    return !mod && !e.shiftKey && !e.altKey && e.key === "Enter";
  }
  if (t === "mod+enter") {
    return (e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key === "Enter";
  }
  return e.key === "Escape";
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
  /** Listen in the capture phase — needed when a focused descendant (e.g. xterm)
   *  swallows the event before it reaches the bubble-phase window listener. */
  capture?: boolean;
  /** Keep firing while the settings overlay is open. The overlay renders on top
   *  of the live app, so app shortcuts are suppressed by default to behave like
   *  a modal; only the panel's own shortcuts (e.g. Esc to close) opt back in. */
  allowWhenSettingsOpen?: boolean;
};

export function useHotkey(
  target: HotkeyTarget,
  handler: (e: KeyboardEvent) => void,
  options: HotkeyOptions = {},
) {
  const {
    enabled = true,
    ignoreEditable = false,
    preventDefault = true,
    capture = false,
    allowWhenSettingsOpen = false,
  } = options;
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  // Always call useKeybindings so hook order stays stable; bindings ref read inside listener.
  const { bindings } = useKeybindings();
  const bindingsRef = useRef(bindings);
  bindingsRef.current = bindings;

  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      const matched = isAction(target)
        ? matchBinding(e, bindingsRef.current[target])
        : matchLiteral(e, target);
      if (!matched) return;
      if (!allowWhenSettingsOpen && isSettingsOverlayOpen()) return;
      if (ignoreEditable && isEditableTarget(e.target)) return;
      if (preventDefault) e.preventDefault();
      if (capture) e.stopPropagation();
      handlerRef.current(e);
    };
    window.addEventListener("keydown", onKey, capture);
    return () => window.removeEventListener("keydown", onKey, capture);
  }, [target, enabled, ignoreEditable, preventDefault, capture, allowWhenSettingsOpen]);
}
