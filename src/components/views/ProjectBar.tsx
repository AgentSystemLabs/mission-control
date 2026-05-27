import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useRouter } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { CircleAlert } from "lucide-react";
import { toast } from "sonner";
import { useProjects, useSettings, queryKeys } from "~/queries";
import type { ProjectWithCounts } from "~/shared/projects";
import { ProjectIcon } from "~/components/ui/ProjectIcon";
import { Icon } from "~/components/ui/Icon";
import { CardFrame } from "~/components/ui/CardFrame";
import { TASK_STATUS_META } from "~/shared/domain";
import { useDismissableMenu } from "~/lib/use-dismissable-menu";
import { useServerEvents } from "~/lib/use-events";
import { useUserTerminals } from "~/lib/user-terminal-store";
import { useBinding } from "~/lib/keybindings/store";
import { formatBinding } from "~/lib/keybindings/format";
import { api } from "~/lib/api";
import { getPinnedProjects, reorderPinnedIds } from "~/lib/pinned-project-order";
import { shouldFlashPinnedProjectLogo } from "./project-bar-activity";
import { getPinnedProjectStatusDots } from "./project-bar-status-dots";

const HOTKEY_LIMIT = 9;
const DRAG_THRESHOLD_PX = 4;

type PointerReorderState = {
  id: string;
  pointerId: number;
  startX: number;
  startY: number;
  moved: boolean;
};

export function ProjectBar() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data: projects } = useProjects();
  const { data: settings } = useSettings();
  const { runningProjectIds, hasRunningLaunchForProject } = useUserTerminals();
  const minimal = settings?.minimalTheme ?? false;
  const invalidateProjects = useCallback(
    () => queryClient.invalidateQueries({ queryKey: queryKeys.projects }),
    [queryClient]
  );
  const sortedPinned = useMemo(() => getPinnedProjects(projects ?? []), [projects]);
  const pinnedById = useMemo(
    () => new Map(sortedPinned.map((project) => [project.id, project])),
    [sortedPinned],
  );
  const [dragOrder, setDragOrder] = useState<string[] | null>(null);
  const pinned = useMemo(() => {
    if (!dragOrder) return sortedPinned;
    return dragOrder.flatMap((id) => {
      const project = pinnedById.get(id);
      return project ? [project] : [];
    });
  }, [dragOrder, pinnedById, sortedPinned]);
  const [menu, setMenu] = useState<{ x: number; y: number; id: string; name: string } | null>(
    null
  );
  const [draggingProjectId, setDraggingProjectId] = useState<string | null>(null);
  const [reorderSaving, setReorderSaving] = useState(false);
  const pointerReorderRef = useRef<PointerReorderState | null>(null);
  const cleanupPointerReorderRef = useRef<(() => void) | null>(null);
  const pinnedIdsRef = useRef<string[]>([]);
  const dragOrderRef = useRef<string[] | null>(null);
  const reorderSavingRef = useRef(false);
  const reorderSaveSeqRef = useRef(0);
  const barRef = useRef<HTMLElement | null>(null);
  const suppressClickRef = useRef(false);
  pinnedIdsRef.current = pinned.map((project) => project.id);
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
  const pinnedSlotBase = useBinding("project.pinnedSlot");
  const pinnedSlotBinding = (slot: number) =>
    formatBinding({ ...pinnedSlotBase, key: String(slot) });

  const cleanupPointerReorder = useCallback(() => {
    cleanupPointerReorderRef.current?.();
    cleanupPointerReorderRef.current = null;
  }, []);

  useEffect(() => cleanupPointerReorder, [cleanupPointerReorder]);

  const persistPinnedOrder = useCallback(
    async (nextOrder: string[]) => {
      const originalOrder = sortedPinned.map((project) => project.id);
      if (nextOrder.join("\0") === originalOrder.join("\0")) {
        setDragOrder(null);
        dragOrderRef.current = null;
        return;
      }
      const saveSeq = ++reorderSaveSeqRef.current;
      reorderSavingRef.current = true;
      setReorderSaving(true);
      const nextOrders = new Map(nextOrder.map((id, index) => [id, index]));
      const previous = queryClient.getQueryData<ProjectWithCounts[]>(queryKeys.projects);
      queryClient.setQueryData<ProjectWithCounts[]>(
        queryKeys.projects,
        (current) =>
          current?.map((project) =>
            nextOrders.has(project.id)
              ? { ...project, pinnedOrder: nextOrders.get(project.id)! }
              : project,
          ) ?? current,
      );
      try {
        const { projects: updated } = await api.reorderPinnedProjects(nextOrder);
        if (saveSeq === reorderSaveSeqRef.current) {
          queryClient.setQueryData(queryKeys.projects, updated);
        }
      } catch (error) {
        if (saveSeq === reorderSaveSeqRef.current) {
          queryClient.setQueryData(queryKeys.projects, previous);
          await invalidateProjects();
          toast.error(error instanceof Error ? error.message : "Could not reorder pinned projects");
        }
      } finally {
        if (saveSeq === reorderSaveSeqRef.current) {
          reorderSavingRef.current = false;
          setReorderSaving(false);
          setDragOrder(null);
          dragOrderRef.current = null;
        }
      }
    },
    [invalidateProjects, queryClient, sortedPinned],
  );

  const resolveDropIndex = useCallback((clientY: number) => {
    const items = barRef.current?.querySelectorAll<HTMLElement>("[data-pinned-item]");
    if (!items?.length) return 0;
    for (let index = 0; index < items.length; index++) {
      const rect = items[index]!.getBoundingClientRect();
      if (clientY < rect.top + rect.height / 2) return index;
    }
    return items.length - 1;
  }, []);

  const clearDragState = useCallback(() => {
    pointerReorderRef.current = null;
    setDraggingProjectId(null);
  }, []);

  const moveDraggedProject = useCallback(
    (drag: PointerReorderState, clientY: number) => {
      const currentOrder = dragOrderRef.current ?? pinnedIdsRef.current;
      const fromIndex = currentOrder.indexOf(drag.id);
      const toIndex = resolveDropIndex(clientY);
      if (fromIndex < 0 || fromIndex === toIndex) return;
      const nextOrder = reorderPinnedIds(currentOrder, fromIndex, toIndex);
      dragOrderRef.current = nextOrder;
      setDragOrder(nextOrder);
    },
    [resolveDropIndex],
  );

  const startPointerReorder = useCallback(
    (projectId: string, event: ReactPointerEvent<HTMLButtonElement>) => {
      if (reorderSavingRef.current) return;
      if (event.button !== 0) return;
      cleanupPointerReorder();
      dragOrderRef.current = null;
      setDragOrder(null);
      clearDragState();
      const initialOrder = [...pinnedIdsRef.current];
      const captureTarget = event.currentTarget;
      pointerReorderRef.current = {
        id: projectId,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        moved: false,
      };
      dragOrderRef.current = initialOrder;
      captureTarget.setPointerCapture(event.pointerId);
      const onPointerMove = (moveEvent: PointerEvent) => {
        const drag = pointerReorderRef.current;
        if (!drag || drag.pointerId !== moveEvent.pointerId) return;
        const deltaX = moveEvent.clientX - drag.startX;
        const deltaY = moveEvent.clientY - drag.startY;
        if (!drag.moved && Math.hypot(deltaX, deltaY) < DRAG_THRESHOLD_PX) return;
        drag.moved = true;
        suppressClickRef.current = true;
        setDraggingProjectId(drag.id);
        moveDraggedProject(drag, moveEvent.clientY);
        moveEvent.preventDefault();
      };

      const cleanupListeners = () => {
        window.removeEventListener("pointermove", onPointerMove);
        window.removeEventListener("pointerup", onPointerUp);
        window.removeEventListener("pointercancel", onPointerCancel);
        if (captureTarget.hasPointerCapture(event.pointerId)) {
          captureTarget.releasePointerCapture(event.pointerId);
        }
        if (cleanupPointerReorderRef.current === cleanupListeners) {
          cleanupPointerReorderRef.current = null;
        }
      };

      const onPointerUp = (upEvent: PointerEvent) => {
        cleanupListeners();
        const drag = pointerReorderRef.current;
        if (!drag || drag.pointerId !== upEvent.pointerId) {
          clearDragState();
          return;
        }
        if (drag.moved) {
          upEvent.preventDefault();
          moveDraggedProject(drag, upEvent.clientY);
          void persistPinnedOrder(dragOrderRef.current ?? initialOrder);
          window.setTimeout(() => {
            suppressClickRef.current = false;
          }, 0);
        } else {
          dragOrderRef.current = null;
          setDragOrder(null);
        }
        clearDragState();
      };

      const onPointerCancel = (cancelEvent: PointerEvent) => {
        if (pointerReorderRef.current?.pointerId !== cancelEvent.pointerId) return;
        cleanupListeners();
        dragOrderRef.current = null;
        setDragOrder(null);
        clearDragState();
      };

      window.addEventListener("pointermove", onPointerMove, { passive: false });
      window.addEventListener("pointerup", onPointerUp);
      window.addEventListener("pointercancel", onPointerCancel);
      cleanupPointerReorderRef.current = cleanupListeners;
    },
    [cleanupPointerReorder, clearDragState, moveDraggedProject, persistPinnedOrder],
  );

  const movePinnedProjectByKeyboard = useCallback(
    (projectId: string, direction: -1 | 1) => {
      if (reorderSavingRef.current) return;
      const currentOrder = [...pinnedIdsRef.current];
      const fromIndex = currentOrder.indexOf(projectId);
      if (fromIndex < 0) return;
      const toIndex = Math.max(0, Math.min(currentOrder.length - 1, fromIndex + direction));
      if (fromIndex === toIndex) return;
      const nextOrder = reorderPinnedIds(currentOrder, fromIndex, toIndex);
      dragOrderRef.current = nextOrder;
      setDragOrder(nextOrder);
      void persistPinnedOrder(nextOrder);
    },
    [persistPinnedOrder],
  );

  if (pinned.length === 0) return null;

  const activeId = router.state.location.pathname.match(/^\/projects\/([^/]+)/)?.[1];
  const activeIndex = pinned.findIndex((p) => p.id === activeId);

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
      ref={barRef}
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
        const isActive = idx === activeIndex;
        const hotkey = idx < HOTKEY_LIMIT ? idx + 1 : null;
        const runningCount = project.taskCounts.running;
        const terminalRunning = runningProjectIds.has(project.id);
        const launchRunning = hasRunningLaunchForProject(project.id, project.launchCommands);
        const logoShouldFlash = shouldFlashPinnedProjectLogo({
          cliRunningCount: runningCount,
          terminalOpen: terminalRunning,
        });
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
        const terminalLabel = terminalRunning ? "terminal running" : null;
        const launchLabel = launchRunning ? "launch running" : null;
        const finishedLabel =
          finishedCount > 0
            ? `${finishedCount} ${finishedCount === 1 ? "session" : "sessions"} finished`
            : null;
        const tooltip = [
          hotkey ? `${project.name} (${pinnedSlotBinding(hotkey)})` : project.name,
          "Drag or press Shift+Arrow Up/Down to reorder pinned projects",
          needsInputLabel,
          launchLabel,
          terminalLabel,
          runningLabel,
          finishedLabel,
        ]
          .filter(Boolean)
          .join(" — ");
        const isDragging = draggingProjectId === project.id;
        return (
          <button
            key={project.id}
            type="button"
            data-pinned-item
            title={tooltip}
            aria-label={tooltip}
            aria-keyshortcuts="Shift+ArrowUp Shift+ArrowDown"
            onPointerDown={(e) => startPointerReorder(project.id, e)}
            onDragStart={(e) => e.preventDefault()}
            onKeyDown={(e) => {
              if (!e.shiftKey || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
              e.preventDefault();
              movePinnedProjectByKeyboard(project.id, e.key === "ArrowUp" ? -1 : 1);
            }}
            onClick={() => {
              if (suppressClickRef.current) {
                suppressClickRef.current = false;
                return;
              }
              router.navigate({ to: "/projects/$id", params: { id: project.id } });
            }}
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
              zIndex: isActive ? 3 : 1,
              cursor: reorderSaving ? "default" : isDragging ? "grabbing" : "grab",
              opacity: isDragging ? 0.55 : 1,
              boxShadow: isDragging ? "0 0 0 2px color-mix(in srgb, var(--accent) 70%, white)" : undefined,
              touchAction: "none",
              userSelect: "none",
              ["WebkitUserDrag" as any]: "none",
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
              className="pinned-project-logo"
              style={{
                position: "relative",
                width: ICON_SIZE,
                height: ICON_SIZE,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
                pointerEvents: "none",
              }}
            >
              <span
                className={`pinned-project-logo-surface${logoShouldFlash ? " pinned-project-logo-surface--running" : ""}`}
                style={{
                  width: ICON_SIZE,
                  height: ICON_SIZE,
                  borderRadius: ICON_SIZE * 0.22,
                }}
              >
                <ProjectIcon project={project} size={ICON_SIZE} />
              </span>
              {launchRunning && (
                <span
                  aria-hidden
                  style={{
                    position: "absolute",
                    top: -4,
                    right: needsInputCount > 0 ? 12 : -4,
                    minWidth: 14,
                    height: 14,
                    padding: "0 2px",
                    borderRadius: HOTKEY_BADGE_RADIUS,
                    background: "var(--surface-3, var(--surface-2))",
                    border: "1px solid var(--border)",
                    color: "var(--accent)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    pointerEvents: "none",
                    zIndex: 4,
                  }}
                >
                  <Icon name="play" size={8} />
                </span>
              )}
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
                    zIndex: 4,
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
                  zIndex: 5,
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
