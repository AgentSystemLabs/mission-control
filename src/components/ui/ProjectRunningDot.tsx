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
        background: running ? "#22c55e" : "var(--text-faint)",
        boxShadow: running ? "0 0 6px #22c55e88" : "none",
        transition: "background 0.15s, box-shadow 0.15s",
      }}
    />
  );
}
