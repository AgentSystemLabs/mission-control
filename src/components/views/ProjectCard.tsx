import { ProjectIcon } from "~/components/ui/ProjectIcon";
import { Icon } from "~/components/ui/Icon";
import { ShimmerBar } from "~/components/ui/ShimmerBar";
import { StatusDot, StatusPill } from "~/components/ui/StatusDot";
import { TASK_STATUSES } from "~/db/schema";
import type { ProjectWithCounts } from "~/server/services/projects";

export type Density = "compact" | "regular" | "spacious";

export function ProjectCard({
  project,
  density,
  onOpen,
  onTogglePin,
}: {
  project: ProjectWithCounts;
  density: Density;
  onOpen: () => void;
  onTogglePin: (id: string) => void;
}) {
  const counts = project.taskCounts;
  const hasActivity = counts.running > 0;
  const totalShown = TASK_STATUSES.reduce((a, s) => a + counts[s], 0);
  const isCompact = density === "compact";
  const isSpacious = density === "spacious";

  return (
    <div
      onClick={onOpen}
      style={{
        background: "var(--surface-1)",
        border: "1px solid var(--border)",
        borderRadius: 12,
        overflow: "hidden",
        cursor: "pointer",
        transition: "border-color 0.15s, transform 0.15s, background 0.15s",
        display: "flex",
        flexDirection: "column",
        position: "relative",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = "var(--border-strong)";
        e.currentTarget.style.background = "var(--surface-2)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = "var(--border)";
        e.currentTarget.style.background = "var(--surface-1)";
      }}
    >
      <ShimmerBar active={hasActivity} />
      <div
        style={{
          padding: isCompact ? 12 : isSpacious ? 20 : 16,
          display: "flex",
          flexDirection: "column",
          gap: isCompact ? 10 : 14,
        }}
      >
        <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
          <ProjectIcon project={project} size={isCompact ? 30 : isSpacious ? 44 : 36} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
              <span
                style={{
                  fontFamily: "var(--mono)",
                  fontSize: isCompact ? 13 : 14,
                  fontWeight: 600,
                  color: "var(--text)",
                  letterSpacing: "-0.01em",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {project.name}
              </span>
              {project.pinned && (
                <Icon name="pin-fill" size={10} style={{ color: "var(--accent)", flexShrink: 0 }} />
              )}
            </div>
            <div
              style={{
                fontFamily: "var(--mono)",
                fontSize: 11,
                color: "var(--text-faint)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {project.path}
            </div>
          </div>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onOpen();
            }}
            style={{
              background: "transparent",
              border: "1px solid var(--border)",
              borderRadius: 6,
              padding: "4px 8px",
              cursor: "pointer",
              color: "var(--text-dim)",
              fontFamily: "var(--mono)",
              fontSize: 11,
              display: "flex",
              alignItems: "center",
              gap: 4,
            }}
            title="Open project"
          >
            Open
            <Icon name="chevron-right" size={11} />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onTogglePin(project.id);
            }}
            style={{
              background: "transparent",
              border: 0,
              padding: 4,
              cursor: "pointer",
              color: project.pinned ? "var(--accent)" : "var(--text-faint)",
              display: "flex",
            }}
            title={project.pinned ? "Unpin" : "Pin"}
          >
            <Icon name={project.pinned ? "pin-fill" : "pin"} size={12} />
          </button>
        </div>

        {!isCompact && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              fontFamily: "var(--mono)",
              fontSize: 11,
              color: "var(--text-dim)",
            }}
          >
            <Icon name="git-branch" size={11} style={{ color: "var(--text-faint)" }} />
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {project.branch}
            </span>
          </div>
        )}

        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          {TASK_STATUSES.map(
            (s) => counts[s] > 0 && <StatusPill key={s} status={s} count={counts[s]} />
          )}
          {totalShown === 0 && (
            <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--text-faint)" }}>
              no active tasks
            </span>
          )}
        </div>

        {!isCompact && hasActivity && project.preview && (
          <div
            style={{
              fontFamily: "var(--mono)",
              fontSize: 11,
              color: "var(--text-dim)",
              background: "var(--surface-0)",
              border: "1px solid var(--border)",
              borderRadius: 6,
              padding: "8px 10px",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <StatusDot status="running" />
            <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{project.preview}</span>
          </div>
        )}
      </div>
    </div>
  );
}
