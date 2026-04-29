export function ProjectRunningDot({
  running,
  size = 8,
}: {
  running: boolean;
  size?: number;
}) {
  return (
    <span
      aria-label={running ? "Running" : "Not running"}
      title={running ? "Running" : "Not running"}
      style={{
        flexShrink: 0,
        width: size,
        height: size,
        borderRadius: "50%",
        background: running ? "var(--accent)" : "var(--text-faint)",
        boxShadow: running ? "0 0 6px var(--accent-glow)" : "none",
        transition: "background 0.15s, box-shadow 0.15s",
        animation: running ? "pulse-dot 1.6s ease-in-out infinite" : "none",
      }}
    />
  );
}
