import { useEffect, useRef } from "react";
import { matchBinding } from "~/lib/keybindings/match";
import { useKeybindings } from "~/lib/keybindings/store";

export type PushToTalkHandlers = {
  /** Fired on keydown of the bound combo (start recording). */
  onStart: () => void;
  /** Fired when the combo is released (stop recording + run the command). */
  onStop: () => void;
  /** Fired when the hold is abandoned (window blur). Falls back to onStop. */
  onCancel?: () => void;
};

/**
 * Hold-to-talk for the `voice.pushToTalk` keybinding. `useHotkey` only fires on
 * keydown, but push-to-talk needs the keyup too — so this is a dedicated pair.
 *
 * Listens in the capture phase so a focused terminal (xterm) can't swallow the
 * combo first. The binding includes Cmd/Ctrl, so it never collides with typing;
 * releasing the main key OR any modifier ends the hold (natural PTT feel).
 */
export function usePushToTalk(
  handlers: PushToTalkHandlers,
  options: { enabled?: boolean } = {},
) {
  const { enabled = true } = options;
  const { bindings } = useKeybindings();
  const bindingsRef = useRef(bindings);
  bindingsRef.current = bindings;
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    if (!enabled) return;
    let recording = false;

    const stop = () => {
      if (!recording) return;
      recording = false;
      handlersRef.current.onStop();
    };
    const cancel = () => {
      if (!recording) return;
      recording = false;
      (handlersRef.current.onCancel ?? handlersRef.current.onStop)();
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (recording || e.repeat) return;
      if (!matchBinding(e, bindingsRef.current["voice.pushToTalk"])) return;
      e.preventDefault();
      recording = true;
      handlersRef.current.onStart();
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (!recording) return;
      const binding = bindingsRef.current["voice.pushToTalk"];
      const key = e.key.toLowerCase();
      const releasedMain = key === binding.key.toLowerCase();
      const releasedMod =
        key === "meta" || key === "control" || key === "shift" || key === "alt";
      if (releasedMain || releasedMod) stop();
    };
    const onBlur = () => cancel();

    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("keyup", onKeyUp, true);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("keyup", onKeyUp, true);
      window.removeEventListener("blur", onBlur);
      cancel();
    };
  }, [enabled]);
}
