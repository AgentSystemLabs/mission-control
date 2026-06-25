import { useState } from "react";
import { createPortal } from "react-dom";
import { Z_INDEX } from "~/lib/z-index";
import { CardFrame } from "~/components/ui/CardFrame";
import { DropdownMenuItem, DropdownMenuSeparator } from "~/components/ui/DropdownMenuItem";
import { ProjectIcon } from "~/components/ui/ProjectIcon";
import { Btn } from "~/components/ui/Btn";
import { ShimmerBar } from "~/components/ui/ShimmerBar";
import { StatusDot, StatusPill } from "~/components/ui/StatusDot";
import { ProjectStatusBadge } from "~/components/ui/ProjectStatusBadge";
import { TASK_STATUSES } from "~/shared/domain";
import { useUserTerminals } from "~/lib/user-terminal-store";
import { useDismissableMenu } from "~/lib/use-dismissable-menu";
import { getProjectActivity, isProjectActive, type ProjectWithCounts } from "~/shared/projects";

type ProjectCardMenu = { x: number; y: number } | null;
const MENU_WIDTH = 196;
const MENU_HEIGHT = 120;

function menuPosition(x: number, y: number): NonNullable<ProjectCardMenu> {
  return {
    x: Math.max(8, Math.min(x, window.innerWidth - MENU_WIDTH - 8)),
    y: Math.max(8, Math.min(y, window.innerHeight - MENU_HEIGHT - 8)),
  };
}

export function ProjectCard({
  project,
  onOpen,
  onEdit,
  onRemove,
  onTogglePin,
}: {
  project: ProjectWithCounts;
  onOpen: () => void;
  onEdit: () => void;
  onRemove: () => void;
  onTogglePin: (id: string) => void;
}) {
  const counts = project.taskCounts;
  const { hasRunningLaunchForProject } = useUserTerminals();
  const launchRunningProjectIds = hasRunningLaunchForProject(project.id, project.launchCommands)
    ? new Set([project.id])
    : new Set<string>();
  const activity = getProjectActivity(project, launchRunningProjectIds);
  const hasActivity = isProjectActive(activity);
  const totalShown = TASK_STATUSES.reduce((a, s) => a + counts[s], 0);
  const [hovered, setHovered] = useState(false);
  const [menu, setMenu] = useState<ProjectCardMenu>(null);
  useDismissableMenu(menu !== null, () => setMenu(null));

  const openMenu = (x: number, y: number) => {
    setMenu(menuPosition(x, y));
  };

  return (
    <CardFrame
      className="mc-project-card"
      glow
      focused={hovered || menu !== null}
      onClick={onOpen}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        openMenu(e.clientX, e.clientY);
      }}
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
      <div aria-hidden style={{ pointerEvents: "none", position: "relative", zIndex: 2 }}>
        <ShimmerBar active={hasActivity} />
      </div>
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
            pointerEvents: "none",
            zIndex: 2,
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
          zIndex: 2,
        }}
      >
        <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onOpen();
            }}
            aria-label={`Open project ${project.name}`}
            style={{
              flex: "1 1 auto",
              minWidth: 0,
              display: "flex",
              alignItems: "flex-start",
              gap: 12,
              padding: 0,
              border: 0,
              background: "transparent",
              color: "inherit",
              font: "inherit",
              textAlign: "left",
              cursor: "pointer",
            }}
          >
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
          </button>
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
            <Btn
              size="sm"
              variant={project.pinned ? "primary" : "ghost"}
              icon={project.pinned ? "pin-fill" : "pin"}
              onClick={(e) => {
                e.stopPropagation();
                onTogglePin(project.id);
              }}
              aria-label={project.pinned ? `Unpin ${project.name}` : `Pin ${project.name}`}
              aria-pressed={project.pinned}
              title={project.pinned ? "Unpin" : "Pin"}
              style={{
                pointerEvents: "auto",
                position: "relative",
                zIndex: 3,
                width: 30,
                minWidth: 30,
                padding: 0,
                paddingInline: 0,
              }}
            />
            <Btn
              size="sm"
              variant="ghost"
              icon="more"
              onClick={(e) => {
                e.stopPropagation();
                const rect = e.currentTarget.getBoundingClientRect();
                openMenu(rect.left, rect.bottom + 4);
              }}
              aria-label={`Project actions for ${project.name}`}
              aria-haspopup="menu"
              aria-expanded={menu !== null}
              title="Project actions"
              style={{
                pointerEvents: "auto",
                position: "relative",
                zIndex: 3,
                width: 30,
                padding: 0,
              }}
            />
          </div>
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
      {menu &&
        createPortal(
          <CardFrame
            role="menu"
            aria-label={`${project.name} actions`}
            solid
            className="mc-project-actions-menu"
            onClick={(e) => e.stopPropagation()}
            style={{
              position: "fixed",
              top: menu.y,
              left: menu.x,
              minWidth: MENU_WIDTH,
              boxShadow: "0 14px 32px rgba(0,0,0,0.42)",
              zIndex: Z_INDEX.popover,
            }}
          >
            <DropdownMenuItem
              icon="settings"
              autoFocus
              onClick={() => {
                setMenu(null);
                onEdit();
              }}
            >
              Edit project
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              danger
              icon="trash"
              onClick={() => {
                setMenu(null);
                onRemove();
              }}
              title="Remove this project from Mission Control. The folder on disk is not touched."
            >
              Remove project
            </DropdownMenuItem>
          </CardFrame>,
          document.body,
        )}
    </CardFrame>
  );
}
