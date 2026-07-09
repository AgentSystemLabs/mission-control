import { useCallback, useEffect } from "react";
import { Btn } from "~/components/ui/Btn";
import { VOICE_SHIP_EVENT } from "~/lib/voice-events";

export function CommitPushButton({
  label = "Ship",
  title,
  variant = "primary",
  size = "sm",
  splitTrailing = false,
  attachedLeading = false,
  enabled = true,
  onShip,
}: {
  label?: string;
  title?: string;
  variant?: "primary" | "ghost" | "gray-frame";
  size?: "sm" | "md";
  /** Right segment of a pill-style split next to the Changes control (toolbar). */
  splitTrailing?: boolean;
  /** Left-attached when fused after a branch/worktree control. */
  attachedLeading?: boolean;
  enabled?: boolean;
  onShip: () => void;
}) {
  const onClick = useCallback(() => {
    if (!enabled) return;
    onShip();
  }, [enabled, onShip]);

  // Voice control: "ship it" / "commit & push" triggers the same primary action.
  useEffect(() => {
    const onVoiceShip = () => onClick();
    window.addEventListener(VOICE_SHIP_EVENT, onVoiceShip);
    return () => window.removeEventListener(VOICE_SHIP_EVENT, onVoiceShip);
  }, [onClick]);

  const tooltip = !enabled
    ? "Ship unavailable until the project folder is valid"
    : (title ?? "Open an AI session to push and sync with remote");

  const className = [
    splitTrailing || attachedLeading ? "mc-btn-attached-left" : null,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <Btn
      variant={variant}
      size={size}
      icon="upload"
      className={className || undefined}
      onClick={onClick}
      disabled={!enabled}
      title={tooltip}
      aria-label={tooltip}
      style={{ fontFamily: "var(--mono)" }}
    >
      {label}
    </Btn>
  );
}
