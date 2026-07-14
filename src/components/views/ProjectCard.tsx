import { useState } from "react";
import { CardFrame } from "~/components/ui/CardFrame";
import { ContextMenuPopover } from "~/components/ui/ContextMenuPopover";
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
import type { Group } from "~/db/schema";

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
  groups,
  onOpen,
  onEdit,
  onRemove,
  onTogglePin,
  onMoveToGroup,
}: {
  project: ProjectWithCounts;
  groups: Group[];
  onOpen: () => void;
  onEdit: () => void;
  onRemove: () => void;
  onTogglePin: (id: string) => void;
  onMoveToGroup: (groupId: string | null) => void | Promise<void>;
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
  // The bespoke ContextMenuPopover has no nested submenus — "Move to group"
  // swaps the menu content to a group list instead.
  const [menuMode, setMenuMode] = useState<"root" | "move">("root");
  useDismissableMenu(menu !== null, () => setMenu(null));

  const openMenu = (x: number, y: number) => {
    setMenuMode("root");
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
      {menu && (
        <ContextMenuPopover anchor={menu} label={`${project.name} actions`} minWidth={MENU_WIDTH}>
          {menuMode === "root" ? (
            <>
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
              {groups.length > 0 && (
                <DropdownMenuItem
                  icon="group"
                  onClick={() => setMenuMode("move")}
                  aria-haspopup="menu"
                >
                  <span style={{ display: "inline-flex", alignItems: "center", width: "100%" }}>
                    <span style={{ flex: 1 }}>Move to group</span>
                    <span aria-hidden style={{ color: "var(--text-faint)" }}>›</span>
                  </span>
                </DropdownMenuItem>
              )}
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
            </>
          ) : (
            <>
              <DropdownMenuItem autoFocus onClick={() => setMenuMode("root")}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  <span aria-hidden style={{ color: "var(--text-faint)" }}>‹</span>
                  <span>Back</span>
                </span>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {groups.map((group) => {
                const selected = project.groupId === group.id;
                return (
                  <DropdownMenuItem
                    key={group.id}
                    leading={
                      <span
                        aria-hidden
                        style={{
                          width: 8,
                          height: 8,
                          borderRadius: "50%",
                          background: group.color,
                          boxShadow: `0 0 5px ${group.color}66`,
                          flexShrink: 0,
                        }}
                      />
                    }
                    aria-current={selected ? "true" : undefined}
                    onClick={() => {
                      setMenu(null);
                      if (!selected) void onMoveToGroup(group.id);
                    }}
                  >
                    <span style={{ display: "inline-flex", alignItems: "center", width: "100%" }}>
                      <span style={{ flex: 1 }}>{group.name}</span>
                      {selected && <span aria-hidden style={{ color: "var(--accent-ink)" }}>✓</span>}
                    </span>
                  </DropdownMenuItem>
                );
              })}
              <DropdownMenuItem
                leading={
                  <span
                    aria-hidden
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: "50%",
                      background: "rgba(232, 230, 223, 0.3)",
                      flexShrink: 0,
                    }}
                  />
                }
                aria-current={project.groupId == null ? "true" : undefined}
                onClick={() => {
                  setMenu(null);
                  if (project.groupId != null) void onMoveToGroup(null);
                }}
              >
                <span style={{ display: "inline-flex", alignItems: "center", width: "100%" }}>
                  <span style={{ flex: 1 }}>Ungrouped</span>
                  {project.groupId == null && (
                    <span aria-hidden style={{ color: "var(--accent-ink)" }}>✓</span>
                  )}
                </span>
              </DropdownMenuItem>
            </>
          )}
        </ContextMenuPopover>
      )}
    </CardFrame>
  );
}
