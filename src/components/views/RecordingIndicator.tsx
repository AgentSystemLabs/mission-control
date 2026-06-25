// Non-blocking corner HUD shown while push-to-talk is held (recording) and
// while the clip is being transcribed. pointer-events: none so it never
// intercepts clicks; role="status" + aria-live so screen readers announce it.

export type VoiceStatus = "idle" | "recording" | "transcribing";

export function RecordingIndicator({ status }: { status: VoiceStatus }) {
  if (status === "idle") return null;
  const recording = status === "recording";
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: "fixed",
        bottom: 20,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 2147483646,
        pointerEvents: "none",
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "8px 16px",
        borderRadius: 999,
        background: "color-mix(in srgb, var(--surface-0) 92%, transparent)",
        border: "1px solid var(--border)",
        boxShadow: "0 6px 22px rgba(0, 0, 0, 0.35)",
        backdropFilter: "blur(8px)",
        color: "var(--text)",
        fontSize: 13,
        fontWeight: 600,
      }}
    >
      <span
        aria-hidden
        style={{
          width: 10,
          height: 10,
          borderRadius: 999,
          background: recording ? "var(--status-failed, #e5484d)" : "var(--accent)",
          animation: "mc-voice-pulse 1s ease-in-out infinite",
        }}
      />
      {recording ? "Listening…" : "Transcribing…"}
    </div>
  );
}
