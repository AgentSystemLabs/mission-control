export function ShimmerBar({ active, color }: { active: boolean; color?: string }) {
  if (!active) {
    return <div style={{ height: 2, background: "var(--border)" }} />;
  }
  const c = color || "var(--accent)";
  return (
    <div
      className="shimmer-bar"
      style={
        {
          ["--shimmer-c" as any]: c,
          background: `linear-gradient(90deg, transparent 0%, transparent 25%, ${c} 50%, transparent 75%, transparent 100%)`,
          backgroundSize: "200% 100%",
        } as React.CSSProperties
      }
    />
  );
}
