import { useCallback, useState } from "react";
import { useRouter } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { CircleAlert } from "lucide-react";
import { useProjects, useSettings, queryKeys } from "~/queries";
import { ProjectIcon } from "~/components/ui/ProjectIcon";
import { Icon } from "~/components/ui/Icon";
import { CardFrame } from "~/components/ui/CardFrame";
import { TASK_STATUS_META } from "~/shared/domain";
import { useDismissableMenu } from "~/lib/use-dismissable-menu";
import { useServerEvents } from "~/lib/use-events";
import { api } from "~/lib/api";
import { getPinnedProjectStatusDots } from "./project-bar-status-dots";

const HOTKEY_LIMIT = 9;

export function ProjectBar() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data: projects } = useProjects();
  const { data: settings } = useSettings();
  const minimal = settings?.minimalTheme ?? false;
  const invalidateProjects = useCallback(
    () => queryClient.invalidateQueries({ queryKey: queryKeys.projects }),
    [queryClient]
  );
  const pinned = (projects ?? []).filter((p) => p.pinned);
  const [menu, setMenu] = useState<{ x: number; y: number; id: string; name: string } | null>(
    null
  );
  const closeMenu = useCallback(() => setMenu(null), []);
  useDismissableMenu(menu !== null, closeMenu);
  useServerEvents(
    useCallback(
      (e) => {
        if (e.type.startsWith("project:") || e.type.startsWith("task:")) {
          void invalidateProjects();
        }
      },
      [invalidateProjects]
    )
  );

  if (pinned.length === 0) return null;

  const activeId = router.state.location.pathname.match(/^\/projects\/([^/]+)/)?.[1];
  const activeIndex = pinned.findIndex((p) => p.id === activeId);
  const modSymbol = typeof navigator !== "undefined" && /Mac/i.test(navigator.platform) ? "⌘" : "Ctrl+";

  const ITEM_WIDTH = 58;
  const ITEM_HEIGHT = 48;
  const ICON_SIZE = 40;
  const GAP = 8;
  const PAD_TOP = minimal ? 18 : 12;
  const PAD_X = minimal ? 4 : 8;
  const BAR_WIDTH = minimal ? 72 : 96;
  const IDLE_ITEM_WIDTH = ITEM_HEIGHT;
  const ITEM_RADIUS = minimal ? 9 : 10;
  const HOTKEY_BADGE_RADIUS = minimal ? 0 : 4;
  const MENU_RADIUS = minimal ? 0 : 6;
  const MENU_ITEM_RADIUS = minimal ? 0 : 4;
  const activeProject = activeIndex >= 0 ? pinned[activeIndex] : null;
  const activeStatusDots = activeProject
    ? getPinnedProjectStatusDots(activeProject.taskCounts)
    : [];
  const activeItemWidth =
    activeProject && activeStatusDots.length > 0 ? ITEM_WIDTH : IDLE_ITEM_WIDTH;

  return (
    <CardFrame
      glow
      role="navigation"
      aria-label="Pinned projects"
      style={{
        width: BAR_WIDTH,
        flexShrink: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: GAP,
        padding: `${PAD_TOP}px ${PAD_X}px`,
        overflowX: "hidden",
        overflowY: "auto",
      }}
    >
      {activeIndex >= 0 && (
        <div
          aria-hidden
          style={{
            position: "absolute",
            top: PAD_TOP,
            left: "50%",
            width: activeItemWidth,
            height: ITEM_HEIGHT,
            marginLeft: -activeItemWidth / 2,
            borderRadius: ITEM_RADIUS,
            border: "2px solid color-mix(in srgb, var(--accent) 88%, black)",
            background: "transparent",
            transform: `translateY(${activeIndex * (ITEM_HEIGHT + GAP)}px)`,
            transition: "transform 0.25s cubic-bezier(0.4, 0, 0.2, 1)",
            pointerEvents: "none",
            zIndex: 2,
          }}
        />
      )}
      {pinned.map((project, idx) => {
        const hotkey = idx < HOTKEY_LIMIT ? idx + 1 : null;
        const runningCount = project.taskCounts.running;
        const finishedCount = project.taskCounts.finished;
        const statusDots = getPinnedProjectStatusDots(project.taskCounts);
        const hasStatusDots = statusDots.length > 0;
        const needsInputCount = project.taskCounts["needs-input"];
        const needsInputLabel =
          needsInputCount > 0
            ? `${needsInputCount} ${needsInputCount === 1 ? "session needs" : "sessions need"} input`
            : null;
        const runningLabel =
          runningCount > 0
            ? `${runningCount} ${runningCount === 1 ? "session" : "sessions"} running`
            : null;
        const finishedLabel =
          finishedCount > 0
            ? `${finishedCount} ${finishedCount === 1 ? "session" : "sessions"} finished`
            : null;
        const tooltip = [
          hotkey ? `${project.name} (${modSymbol}${hotkey})` : project.name,
          needsInputLabel,
          runningLabel,
          finishedLabel,
        ]
          .filter(Boolean)
          .join(" — ");
        return (
          <button
            key={project.id}
            type="button"
            title={tooltip}
            aria-label={tooltip}
            onClick={() =>
              router.navigate({ to: "/projects/$id", params: { id: project.id } })
            }
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setMenu({ x: e.clientX, y: e.clientY, id: project.id, name: project.name });
            }}
            style={{
              position: "relative",
              width: hasStatusDots ? ITEM_WIDTH : IDLE_ITEM_WIDTH,
              height: ITEM_HEIGHT,
              flexShrink: 0,
              padding: hasStatusDots ? "4px 6px 4px 14px" : 4,
              border: "1px solid transparent",
              borderRadius: ITEM_RADIUS,
              background: "transparent",
              zIndex: 1,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              transition: "border-color 0.15s",
            }}
          >
            {statusDots.length > 0 && (
              <span
                aria-hidden
                style={{
                  position: "absolute",
                  left: 5,
                  top: "50%",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 3,
                  transform: "translateY(-50%)",
                  pointerEvents: "none",
                }}
              >
                {statusDots.map((status, dot) => {
                  const color =
                    status === "running" ? "var(--accent)" : TASK_STATUS_META[status].color;
                  return (
                    <span
                      key={`${status}-${dot}`}
                      style={{
                        width: 5,
                        height: 5,
                        borderRadius: "50%",
                        background: color,
                        boxShadow: status === "running" ? "0 0 5px var(--accent-glow)" : "none",
                      }}
                    />
                  );
                })}
              </span>
            )}
            <span
              aria-hidden
              style={{
                position: "relative",
                width: ICON_SIZE,
                height: ICON_SIZE,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              <ProjectIcon project={project} size={ICON_SIZE} />
              {needsInputCount > 0 && (
                <span
                  style={{
                    position: "absolute",
                    top: -4,
                    right: -4,
                    width: 16,
                    height: 16,
                    borderRadius: 999,
                    background: "var(--surface-3, var(--surface-2))",
                    border: "1px solid var(--border)",
                    color: "var(--text-dim)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    boxShadow: "0 1px 3px rgba(0,0,0,0.22)",
                    pointerEvents: "none",
                  }}
                >
                  <CircleAlert size={11} strokeWidth={2.4} />
                </span>
              )}
            </span>
            {hotkey && (
              <span
                aria-hidden
                style={{
                  position: "absolute",
                  bottom: -2,
                  right: -2,
                  minWidth: 14,
                  height: 14,
                  padding: "0 3px",
                  borderRadius: HOTKEY_BADGE_RADIUS,
                  background: "var(--surface-3, var(--surface-2))",
                  border: "1px solid var(--border)",
                  color: "var(--text-faint)",
                  fontFamily: "var(--mono)",
                  fontSize: 9,
                  lineHeight: "12px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {hotkey}
              </span>
            )}
          </button>
        );
      })}
      {menu && (
        <div
          role="menu"
          aria-label={`${menu.name} actions`}
          onClick={(e) => e.stopPropagation()}
          style={{
            position: "fixed",
            top: menu.y,
            left: menu.x,
            zIndex: 1000,
            background: "var(--surface-2)",
            border: "1px solid var(--border)",
            borderRadius: MENU_RADIUS,
            padding: 4,
            minWidth: 140,
            boxShadow: "0 6px 20px rgba(0,0,0,0.4)",
          }}
        >
          <button
            type="button"
            role="menuitem"
            autoFocus
            onClick={async (e) => {
              e.stopPropagation();
              const id = menu.id;
              setMenu(null);
              await api.togglePin(id);
              await invalidateProjects();
            }}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              width: "100%",
              padding: "7px 10px",
              background: "transparent",
              border: 0,
              borderRadius: MENU_ITEM_RADIUS,
              cursor: "pointer",
              color: "var(--text)",
              fontSize: 12,
              fontFamily: "var(--mono)",
              textAlign: "left",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surface-3)")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
          >
            <Icon name="pin" size={12} /> Unpin
          </button>
        </div>
      )}
    </CardFrame>
  );
}
