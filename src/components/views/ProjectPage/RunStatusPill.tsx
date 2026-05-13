import type { CSSProperties } from "react";
import { Btn } from "~/components/ui/Btn";
import { HotkeyTooltip } from "~/components/ui/Tooltip";

export function RunStatusPill({
  running,
  launching,
  stopping,
  launchUrl,
  onStart,
  onOpenUrl,
  onStop,
}: {
  running: boolean;
  launching: boolean;
  stopping: boolean;
  launchUrl: string | null;
  onStart: () => void;
  onOpenUrl: () => void;
  onStop: () => void;
}) {
  const busy = launching || stopping;
  const label = stopping
    ? "Stopping…"
    : launching
      ? "Starting…"
      : running
        ? "Running"
        : "Offline";

  const interactive = !busy && !running;
  const onClick = busy ? undefined : running ? undefined : onStart;

  const title = busy
    ? label
    : running
      ? "Running"
      : "Run launch commands";

  const tone = running || launching ? "active" : "idle";
  const dotColor = tone === "active" ? "var(--accent)" : "var(--text-faint)";
  const borderColor = tone === "active" ? "var(--accent-border)" : "var(--border)";
  const background = tone === "active" ? "var(--accent-faint)" : "var(--surface-0)";
  const fg = tone === "active" ? "var(--accent)" : "var(--text-dim)";

  const activeFrameIconStyle: CSSProperties = {
    minWidth: 52,
    paddingInline: 0,
    fontFamily: "var(--mono)",
  };

  const showRunningSplit = running && !busy;

  if (showRunningSplit) {
    return (
      <div
        role="group"
        aria-label="Project launch — running"
        style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
      >
        {launchUrl ? (
          <Btn
            variant="ghost"
            icon="external-link"
            onClick={onOpenUrl}
            title={`Open ${launchUrl} in browser`}
            aria-label={`Open ${launchUrl} in browser`}
          >
            Open
          </Btn>
        ) : null}
        <HotkeyTooltip action="project.runToggle" label="Stop launch commands">
          <Btn
            variant="danger"
            icon="stop"
            onClick={() => onStop()}
            aria-label="Stop launch commands"
          >
            Stop
          </Btn>
        </HotkeyTooltip>
      </div>
    );
  }

  const showOfflineSplit = !running && !busy;

  if (showOfflineSplit) {
    return (
      <HotkeyTooltip action="project.runToggle" label={title}>
        <Btn
          variant="ghost"
          icon="play"
          onClick={onStart}
          aria-label={title}
          style={{ fontFamily: "var(--mono)" }}
        />
      </HotkeyTooltip>
    );
  }

  return (
    <HotkeyTooltip action="project.runToggle" label={title}>
      <button
        type="button"
        onClick={onClick}
        disabled={!interactive}
        aria-label={title}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          height: 28,
          padding: "0 12px",
          borderRadius: 999,
          border: `1px solid ${borderColor}`,
          background,
          color: fg,
          fontFamily: "var(--mono)",
          fontSize: 11.5,
          fontWeight: 600,
          cursor: interactive ? "pointer" : "default",
          opacity: busy ? 0.7 : 1,
          transition: "background 0.12s, border-color 0.12s, color 0.12s",
          boxShadow: running ? "0 0 8px var(--accent-glow)" : "none",
        }}
      >
        <span
          aria-hidden
          style={{
            width: 7,
            height: 7,
            borderRadius: "50%",
            background: dotColor,
            boxShadow: running ? "0 0 6px var(--accent-glow)" : "none",
            animation: launching || stopping ? "pulse-border 1.4s ease-in-out infinite" : "none",
          }}
        />
        <span>{label}</span>
      </button>
    </HotkeyTooltip>
  );
}
