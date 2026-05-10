import { useState } from "react";
import { CardFrame } from "~/components/ui/CardFrame";
import { ProjectIcon } from "~/components/ui/ProjectIcon";
import { Icon } from "~/components/ui/Icon";
import { Btn } from "~/components/ui/Btn";
import { ShimmerBar } from "~/components/ui/ShimmerBar";
import { StatusDot, StatusPill } from "~/components/ui/StatusDot";
import { ProjectStatusBadge } from "~/components/ui/ProjectStatusBadge";
import { TASK_STATUSES } from "~/shared/domain";
import { useUserTerminals } from "~/lib/user-terminal-store";
import { getProjectActivity, isProjectActive, type ProjectWithCounts } from "~/shared/projects";

export function ProjectCard({
  project,
  onOpen,
  onTogglePin,
}: {
  project: ProjectWithCounts;
  onOpen: () => void;
  onTogglePin: (id: string) => void;
}) {
  const counts = project.taskCounts;
  const { runningProjectIds } = useUserTerminals();
  const activity = getProjectActivity(project, runningProjectIds);
  const hasActivity = isProjectActive(activity);
  const totalShown = TASK_STATUSES.reduce((a, s) => a + counts[s], 0);
  const [hovered, setHovered] = useState(false);
  return (
    <CardFrame
      glow
      focused={hovered}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        width: "100%",
        cursor: "pointer",
        transition: "box-shadow 0.15s, background 0.15s",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <button
        type="button"
        onClick={onOpen}
        aria-label={`Open project ${project.name}`}
        style={{
          position: "absolute",
          inset: 0,
          zIndex: 0,
          background: "transparent",
          border: 0,
          padding: 0,
          margin: 0,
          cursor: "pointer",
          borderRadius: "inherit",
        }}
      />
      <ShimmerBar active={hasActivity} />
      {hasActivity && (
        <div
          aria-hidden
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            bottom: 0,
            width: 3,
            background: "var(--accent)",
            boxShadow: "0 0 14px var(--accent-glow)",
          }}
        />
      )}
      <div
        style={{
          padding: 16,
          display: "flex",
          flexDirection: "column",
          gap: 14,
          position: "relative",
          zIndex: 1,
          pointerEvents: "none",
        }}
      >
        <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
          <ProjectIcon project={project} size={36} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 2 }}>
              <span
                style={{
                  fontFamily: "var(--mono)",
                  fontSize: 14,
                  fontWeight: 600,
                  color: "var(--text)",
                  letterSpacing: "-0.01em",
                  flex: "1 1 auto",
                  minWidth: 0,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {project.name}
              </span>
            </div>
            <div style={{ display: "flex", alignItems: "center", marginTop: 4 }}>
              <ProjectStatusBadge activity={activity} />
            </div>
          </div>
          <Btn
            size="sm"
            variant={project.pinned ? "accent" : "ghost"}
            icon={project.pinned ? "pin-fill" : "pin"}
            onClick={(e) => {
              e.stopPropagation();
              onTogglePin(project.id);
            }}
            aria-label={project.pinned ? `Unpin ${project.name}` : `Pin ${project.name}`}
            title={project.pinned ? "Unpin" : "Pin"}
            style={{ pointerEvents: "auto", position: "relative", zIndex: 1 }}
          >
            {project.pinned ? "Pinned" : "Pin"}
          </Btn>
        </div>

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

        {hasActivity && project.preview && (
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
    </CardFrame>
  );
}
