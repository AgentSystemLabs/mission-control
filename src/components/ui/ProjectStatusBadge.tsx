export function ProjectStatusBadge({ active }: { active: boolean }) {
  return (
    <span
      title={active ? "Project is online" : "Project is offline"}
      aria-label={active ? "Project is online" : "Project is offline"}
      style={{
        flexShrink: 0,
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        height: 18,
        padding: "0 7px",
        borderRadius: 999,
        border: `1px solid ${active ? "var(--accent-border)" : "var(--border)"}`,
        background: active ? "var(--accent-faint)" : "var(--surface-0)",
        color: active ? "var(--accent)" : "var(--text-faint)",
        fontFamily: "var(--mono)",
        fontSize: 10,
        fontWeight: 600,
        lineHeight: 1,
      }}
    >
      <span
        aria-hidden
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: active ? "var(--accent)" : "var(--text-faint)",
          boxShadow: active ? "0 0 7px var(--accent-glow)" : "none",
        }}
      />
      {active ? "Online" : "Offline"}
    </span>
  );
}
