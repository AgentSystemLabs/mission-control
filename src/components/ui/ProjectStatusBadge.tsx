import type { ProjectActivityState } from "~/shared/projects";

const ACTIVITY_LABELS: Record<ProjectActivityState, string> = {
  offline: "Offline",
  "launch-running": "Launch running",
  "agent-running": "Agent running",
  "needs-input": "Needs input",
  interrupted: "Interrupted",
};

export function ProjectStatusBadge({ activity }: { activity: ProjectActivityState }) {
  const active = activity !== "offline";
  const label = ACTIVITY_LABELS[activity];
  return (
    <span
      title={label}
      aria-label={label}
      className="mc-project-status-badge"
      data-active={active || undefined}
      style={{
        flexShrink: 0,
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        height: 18,
        padding: "0 7px",
        borderRadius: 999,
        color: active ? "var(--accent-ink)" : "var(--text-faint)",
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
      {label}
    </span>
  );
}
