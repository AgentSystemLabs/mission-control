// Header push-to-talk button. A pointer-hold (or focus + Space/Enter hold)
// alternative to the `voice.pushToTalk` keybinding: press and hold to record,
// release to transcribe + run the command. Visible only when voice control is
// enabled (Settings → Beta), matching VoiceController's own gate. It dispatches
// the PTT control events; VoiceController owns the actual recording flow.

import { useEffect, useRef, useState } from "react";
import { isElectron } from "~/lib/electron";
import { useSettings } from "~/queries";
import { useFormattedBinding } from "~/lib/keybindings/store";
import { Btn } from "~/components/ui/Btn";
import {
  dispatchVoicePttStart,
  dispatchVoicePttStop,
  dispatchVoicePttCancel,
} from "~/lib/voice-events";

export function VoicePushToTalkButton() {
  const { data: settings } = useSettings();
  // Same gate as VoiceController — only offer the button where the flow runs.
  const enabled = isElectron() && (settings?.voiceControlEnabled ?? false);
  const shortcut = useFormattedBinding("voice.pushToTalk");

  const [holding, setHolding] = useState(false);
  const holdingRef = useRef(false);

  const start = () => {
    if (holdingRef.current) return;
    holdingRef.current = true;
    setHolding(true);
    dispatchVoicePttStart();
  };
  const stop = () => {
    if (!holdingRef.current) return;
    holdingRef.current = false;
    setHolding(false);
    dispatchVoicePttStop();
  };
  const cancel = () => {
    if (!holdingRef.current) return;
    holdingRef.current = false;
    setHolding(false);
    dispatchVoicePttCancel();
  };

  // Release from anywhere ends the hold, and a window blur cancels it — mirrors
  // the keyboard push-to-talk, which listens for keyup/blur on the window.
  useEffect(() => {
    if (!holding) return;
    const onPointerUp = () => stop();
    const onBlur = () => cancel();
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("blur", onBlur);
    };
  }, [holding]);

  if (!enabled) return null;

  const label = holding ? "Listening… release to send" : `Hold to talk (${shortcut})`;
  return (
    <Btn
      variant="ghost"
      icon="mic"
      aria-label={label}
      aria-pressed={holding}
      title={label}
      onPointerDown={(e) => {
        if (e.button !== 0) return; // primary button only
        e.preventDefault();
        start();
      }}
      onKeyDown={(e) => {
        if (e.repeat) return;
        if (e.key === " " || e.key === "Enter") {
          e.preventDefault();
          start();
        }
      }}
      onKeyUp={(e) => {
        if (e.key === " " || e.key === "Enter") {
          e.preventDefault();
          stop();
        }
      }}
      onContextMenu={(e) => e.preventDefault()}
      style={holding ? { color: "var(--status-failed, #e5484d)" } : undefined}
    />
  );
}
