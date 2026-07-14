import { Fragment, memo, useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { CircleAlert } from "lucide-react";
import { toast } from "sonner";
import { useGroups, useSandboxes, useScopedProjects, useSettings, queryKeys } from "~/queries";
import type { ProjectWithCounts } from "~/shared/projects";
import type { Group } from "~/db/schema";
import { ProjectIcon } from "~/components/ui/ProjectIcon";
import { Icon } from "~/components/ui/Icon";
import { CardFrame } from "~/components/ui/CardFrame";
import { ContextMenuPopover } from "~/components/ui/ContextMenuPopover";
import { DropdownMenuItem } from "~/components/ui/DropdownMenuItem";
import { ProjectDialog } from "~/components/views/ProjectDialog";
import { TASK_STATUS_META } from "~/shared/domain";
import { useDismissableMenu } from "~/lib/use-dismissable-menu";
import { useServerEvents } from "~/lib/use-events";
import { useDebouncedCallback } from "~/lib/use-debounced-callback";
import { useUserTerminals } from "~/lib/user-terminal-store";
import { useBinding } from "~/lib/keybindings/store";
import { formatBinding } from "~/lib/keybindings/format";
import { PINNED_SLOT_COUNT } from "~/lib/keybindings/match";
import { api } from "~/lib/api";
import { getPinnedProjects, reorderPinnedIds } from "~/lib/pinned-project-order";
import { ACTIVE_GROUP_ALL, useActiveGroup } from "~/lib/active-group";
import { clusterPinnedByGroup, getGroupRailCluster } from "~/lib/rail-projects";
import { shouldFlashPinnedProjectLogo } from "./project-bar-activity";
import { getPinnedProjectStatusDots } from "./project-bar-status-dots";

const HOTKEY_LIMIT = PINNED_SLOT_COUNT;
const DRAG_THRESHOLD_PX = 4;

const ITEM_WIDTH = 58;
const ITEM_HEIGHT = 48;
const ICON_SIZE = 40;
const GAP = 8;
const DIVIDER_HEIGHT = 2;
const HEADER_HEIGHT = 16;
const GROUP_LABEL_HEIGHT = 20;
// Settle: how long a dropped group cluster takes to ease into its final slot
// before the reorder is committed to the DOM.
const GROUP_SETTLE_MS = 200;
const GROUP_SETTLE_EASE = "cubic-bezier(0.22, 1, 0.36, 1)";

// The rail is narrow, so a cluster's group name is abbreviated to its first few
// letters at the divider. Full name stays available in the label's tooltip.
const shortGroupName = (name: string) => name.trim().slice(0, 4).toUpperCase();

// One row of the rail as measured at drag start — a cluster header (group
// label or the Ungrouped label) or a project tile. The drag math runs entirely
// against this frozen snapshot.
type RailRow = {
  kind: "header" | "tile";
  /** Shift-map key: project id for tiles, `hdr:<clusterKey>` for headers. */
  key: string;
  cluster: string;
  top: number;
  height: number;
};

// Memoized: the shell re-renders on route/settings changes, but ProjectBar's
// only prop is a stable boolean — it should re-render only when `disabled`
// flips or its own query subscriptions move, never just because the shell did.
export const ProjectBar = memo(function ProjectBar({ disabled = false }: { disabled?: boolean }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data: projects } = useScopedProjects();
  const { data: sandboxState } = useSandboxes();
  const { data: groups = [] } = useGroups();
  const { data: settings } = useSettings();
  const { hasRunningLaunchForProject } = useUserTerminals();
  const minimal = settings?.minimalTheme ?? false;
  const invalidateProjects = useCallback(
    () => queryClient.invalidateQueries({ queryKey: queryKeys.projects }),
    [queryClient]
  );
  const invalidateProject = useCallback(
    (id: string) => queryClient.invalidateQueries({ queryKey: queryKeys.project(id) }),
    [queryClient]
  );
  const createGroupForSelection = useCallback(
    async (name: string) => {
      const { group } = await api.createGroup({ name });
      queryClient.setQueryData<Group[]>(queryKeys.groups, (current) =>
        current ? [...current, group] : [group],
      );
      await queryClient.invalidateQueries({ queryKey: queryKeys.groups });
      return group;
    },
    [queryClient],
  );
  const sortedPinned = useMemo(() => getPinnedProjects(projects ?? []), [projects]);
  const { activeGroup } = useActiveGroup();
  // With a group active the rail becomes that group's workspace: every project
  // in the group (pinned first), not just pinned ones. With "all" active it
  // stays the pinned rail, clustered by group with color divider lines.
  const groupScoped = activeGroup !== ACTIVE_GROUP_ALL;
  const [menu, setMenu] = useState<{ x: number; y: number; id: string; name: string } | null>(
    null
  );
  const [editingProject, setEditingProject] = useState<ProjectWithCounts | null>(null);
  // Live project-tile drag. Same architecture as the group drag below: the
  // clustered DOM stays exactly as rendered (groups and labels visible the
  // whole time), the grabbed tile rides the pointer via `delta`, and the other
  // rows — tiles AND headers — translate via `shifts` to open the target slot.
  // The slot can be in ANY cluster, which is how a tile moves between groups;
  // `targetCluster` drives the receiving group's header highlight.
  const [projectDrag, setProjectDrag] = useState<{
    id: string;
    fromCluster: string;
    targetCluster: string;
    delta: number;
    shifts: Record<string, number>;
    settling: boolean;
  } | null>(null);
  // Group (cluster) reorder — dragging a cluster's name label rearranges the
  // groups themselves. `groupDragOrder` overrides the server group order while
  // an optimistic reorder is in flight.
  const [groupDragOrder, setGroupDragOrder] = useState<string[] | null>(null);
  // Live group drag. The DOM order NEVER changes while the drag is in
  // progress — the grabbed cluster (header + tiles) rides the pointer via
  // `delta`, and displaced clusters slide out of the way via `shifts`
  // (cluster key → translateY). `settling` marks the drop animation, where the
  // block eases into its final slot before the reorder is committed. Keeping
  // the DOM static is what kills the jitter: reordering mid-drag moves the
  // drop targets under the pointer, which re-triggers the opposite swap.
  const [groupDrag, setGroupDrag] = useState<{
    id: string;
    delta: number;
    shifts: Record<string, number>;
    settling: boolean;
  } | null>(null);
  // Group order the rail clusters by — the optimistic drag order while a group
  // reorder is live, otherwise the server order. Groups not named in the drag
  // order (e.g. created mid-drag) keep their server position at the end.
  const orderedGroups = useMemo(() => {
    if (!groupDragOrder) return groups;
    const byId = new Map(groups.map((group) => [group.id, group]));
    const seen = new Set<string>();
    const out: Group[] = [];
    for (const id of groupDragOrder) {
      const group = byId.get(id);
      if (group) {
        out.push(group);
        seen.add(id);
      }
    }
    for (const group of groups) if (!seen.has(group.id)) out.push(group);
    return out;
  }, [groupDragOrder, groups]);
  const railClusters = useMemo(() => {
    if (!groupScoped) return clusterPinnedByGroup(sortedPinned, orderedGroups);
    const cluster = getGroupRailCluster(projects ?? [], orderedGroups, activeGroup);
    return cluster.projects.length > 0 ? [cluster] : [];
  }, [activeGroup, groupScoped, orderedGroups, sortedPinned, projects]);
  const visible = useMemo(() => railClusters.flatMap((c) => c.projects), [railClusters]);
  const visibleById = useMemo(
    () => new Map(visible.map((project) => [project.id, project])),
    [visible],
  );
  // A single floating name label that slides out to the right of the hovered
  // tile. Kept alive while the pointer sweeps between tiles (only the rail's
  // own onMouseLeave clears it) so it glides vertically to the newly-hovered
  // project instead of flickering out and back in.
  const [hoverLabel, setHoverLabel] = useState<{ name: string; top: number; left: number } | null>(
    null,
  );
  const showHoverLabel = useCallback(
    (name: string, event: ReactMouseEvent<HTMLButtonElement>) => {
      const rect = event.currentTarget.getBoundingClientRect();
      setHoverLabel({ name, top: rect.top + rect.height / 2, left: rect.right + 10 });
    },
    [],
  );
  const clearHoverLabel = useCallback(() => setHoverLabel(null), []);
  const [reorderSaving, setReorderSaving] = useState(false);
  const pinnedIdsRef = useRef<string[]>([]);
  const groupDragOrderRef = useRef<string[] | null>(null);
  const groupReorderSavingRef = useRef(false);
  // True while a dropped cluster/tile is easing into its slot — new drags wait
  // for the commit so they never measure mid-animation geometry.
  const groupSettleRef = useRef(false);
  const projectSettleRef = useRef(false);
  const reorderSavingRef = useRef(false);
  const reorderSaveSeqRef = useRef(0);
  const barRef = useRef<HTMLElement | null>(null);
  const suppressClickRef = useRef(false);
  // Keyboard reorder operates on the VISIBLE order (the clustered rail), which
  // is also the order persisted on drop. Group-workspace mode keeps the plain
  // pinned order (reorder is disabled there and `visible` contains unpinned
  // projects).
  pinnedIdsRef.current = groupScoped
    ? sortedPinned.map((project) => project.id)
    : visible.map((project) => project.id);
  const closeMenu = useCallback(() => setMenu(null), []);
  useDismissableMenu(menu !== null, closeMenu);

  useEffect(() => {
    setProjectDrag(null);
    setGroupDragOrder(null);
    groupDragOrderRef.current = null;
    setGroupDrag(null);
    setMenu(null);
  }, [sandboxState?.activeScopeId, sandboxState?.enabled]);
  // Stop overriding once the server group order catches up to the optimistic
  // one (or diverges from it) — the fetched list is authoritative again.
  useEffect(() => {
    if (!groupDragOrder || groupDrag) return;
    const serverIds = groups.map((group) => group.id).join("\0");
    if (groupDragOrder.join("\0") === serverIds) {
      setGroupDragOrder(null);
      groupDragOrderRef.current = null;
    }
  }, [groupDrag, groupDragOrder, groups]);
  // The sidebar's status-dot counts move on task:updated too, so we can't drop
  // task events — but a burst of them should refetch the projects list once, not
  // once per event.
  const debouncedInvalidateProjects = useDebouncedCallback(() => void invalidateProjects(), 150);
  useServerEvents(
    useCallback(
      (e) => {
        if (e.type.startsWith("project:") || e.type.startsWith("task:")) {
          debouncedInvalidateProjects();
        }
        // The rail renders group colors/labels (cluster dividers, workspace
        // header) — keep them live when groups change elsewhere.
        if (e.type.startsWith("group:")) {
          void queryClient.invalidateQueries({ queryKey: queryKeys.groups });
        }
      },
      [debouncedInvalidateProjects, queryClient]
    )
  );
  const pinnedSlotBase = useBinding("project.pinnedSlot");
  const pinnedSlotBinding = (slot: number) =>
    formatBinding({ ...pinnedSlotBase, key: String(slot) });

  // Persist a project drop: the new global pinned order, plus the group
  // reassignment when the tile was dropped into a different cluster. The
  // optimistic update applies both, so the rail re-clusters instantly.
  const persistProjectOrder = useCallback(
    async (
      nextOrder: string[],
      groupChange: { projectId: string; groupId: string | null } | null,
    ) => {
      const originalOrder = sortedPinned.map((project) => project.id);
      if (!groupChange && nextOrder.join("\0") === originalOrder.join("\0")) return;
      const saveSeq = ++reorderSaveSeqRef.current;
      reorderSavingRef.current = true;
      setReorderSaving(true);
      const nextOrders = new Map(nextOrder.map((id, index) => [id, index]));
      const previous = queryClient.getQueryData<ProjectWithCounts[]>(queryKeys.projects);
      queryClient.setQueryData<ProjectWithCounts[]>(
        queryKeys.projects,
        (current) =>
          current?.map((project) => {
            let next = project;
            if (nextOrders.has(next.id)) {
              next = { ...next, pinnedOrder: nextOrders.get(next.id)! };
            }
            if (groupChange && next.id === groupChange.projectId) {
              next = { ...next, groupId: groupChange.groupId };
            }
            return next;
          }) ?? current,
      );
      try {
        if (groupChange) {
          await api.updateProject(groupChange.projectId, { groupId: groupChange.groupId });
        }
        const { projects: updated } = await api.reorderPinnedProjects(nextOrder);
        if (saveSeq === reorderSaveSeqRef.current) {
          queryClient.setQueryData(queryKeys.projects, updated);
        }
      } catch (error) {
        if (saveSeq === reorderSaveSeqRef.current) {
          queryClient.setQueryData(queryKeys.projects, previous);
          await invalidateProjects();
          toast.error(error instanceof Error ? error.message : "Could not move project");
        }
      } finally {
        if (saveSeq === reorderSaveSeqRef.current) {
          reorderSavingRef.current = false;
          setReorderSaving(false);
        }
      }
    },
    [invalidateProjects, queryClient, sortedPinned],
  );

  const startProjectPointerDrag = useCallback(
    (projectId: string, event: ReactPointerEvent<HTMLButtonElement>) => {
      if (event.button !== 0) return;
      if (reorderSavingRef.current || projectSettleRef.current || groupSettleRef.current) return;
      clearHoverLabel();
      const startX = event.clientX;
      const startY = event.clientY;
      // Freeze the rail's geometry once: every row (cluster headers AND tiles)
      // in document order. The clustered DOM never reorders mid-drag — the
      // grabbed tile rides the pointer while the other rows translate to open
      // the target slot, so the groups stay visible and the drop targets can't
      // move under the pointer.
      const bar = barRef.current;
      const rows: RailRow[] = Array.from(
        bar?.querySelectorAll<HTMLElement>("[data-cluster-header], [data-pinned-item]") ?? [],
      ).flatMap((el): RailRow[] => {
        const rect = el.getBoundingClientRect();
        const headerCluster = el.dataset.clusterHeader;
        if (headerCluster) {
          return [
            {
              kind: "header" as const,
              key: `hdr:${headerCluster}`,
              cluster: headerCluster,
              top: rect.top,
              height: rect.height,
            },
          ];
        }
        const id = el.dataset.projectId;
        const cluster = el.dataset.clusterId;
        if (!id || !cluster) return [];
        return [{ kind: "tile" as const, key: id, cluster, top: rect.top, height: rect.height }];
      });
      const fromRow = rows.findIndex((row) => row.kind === "tile" && row.key === projectId);
      if (fromRow < 0) return;
      const draggedRect = rows[fromRow]!;
      const fromCluster = draggedRect.cluster;
      const rowShift = draggedRect.height + GAP;
      // Every position the tile can land in: right after a header (top of that
      // cluster — including OTHER groups' headers, which is how a tile moves
      // between groups) or right after any other tile. Slot tops are measured
      // in the layout without the dragged tile, i.e. the final layout.
      type Slot = { afterRow: number; top: number; cluster: string; flatIndex: number };
      const slots: Slot[] = [];
      {
        let tileCount = 0;
        for (let i = 0; i < rows.length; i++) {
          if (i === fromRow) continue;
          const row = rows[i]!;
          const adjTop = row.top - (i > fromRow ? rowShift : 0);
          if (row.kind === "tile") tileCount++;
          slots.push({
            afterRow: i,
            top: adjTop + row.height + GAP,
            cluster: row.cluster,
            flatIndex: tileCount,
          });
        }
      }
      const homeSlot = slots.find((slot) => slot.afterRow === fromRow - 1);
      if (!homeSlot || slots.length < 2) return;
      const minDelta = slots[0]!.top - draggedRect.top;
      const maxDelta = slots[slots.length - 1]!.top - draggedRect.top;
      const handle = event.currentTarget;
      handle.setPointerCapture(event.pointerId);
      let moved = false;
      let currentSlot = homeSlot;

      const shiftsFor = (slot: Slot) => {
        // Rows strictly between the tile's origin and its slot — headers
        // included — slide one tile-height to close the old hole and open the
        // new one; everything else stays put.
        const shifts: Record<string, number> = {};
        if (slot.afterRow > fromRow) {
          for (let i = fromRow + 1; i <= slot.afterRow; i++) shifts[rows[i]!.key] = -rowShift;
        } else {
          for (let i = slot.afterRow + 1; i < fromRow; i++) shifts[rows[i]!.key] = rowShift;
        }
        return shifts;
      };

      const onMove = (moveEvent: PointerEvent) => {
        if (moveEvent.pointerId !== event.pointerId) return;
        if (!moved && Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) < DRAG_THRESHOLD_PX) {
          return;
        }
        moved = true;
        suppressClickRef.current = true;
        const delta = Math.max(minDelta, Math.min(maxDelta, moveEvent.clientY - startY));
        // Nearest slot to the tile's live top. Slot tops are frozen and
        // sorted, so the choice is monotonic in the pointer position and
        // can't oscillate.
        const liveTop = draggedRect.top + delta;
        currentSlot = slots.reduce((best, slot) =>
          Math.abs(slot.top - liveTop) < Math.abs(best.top - liveTop) ? slot : best,
        );
        setProjectDrag({
          id: projectId,
          fromCluster,
          targetCluster: currentSlot.cluster,
          delta,
          shifts: shiftsFor(currentSlot),
          settling: false,
        });
        moveEvent.preventDefault();
      };

      const cleanup = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onCancel);
        if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
      };

      const onUp = (upEvent: PointerEvent) => {
        if (upEvent.pointerId !== event.pointerId) return;
        cleanup();
        if (!moved) {
          setProjectDrag(null);
          return;
        }
        upEvent.preventDefault();
        window.setTimeout(() => {
          suppressClickRef.current = false;
        }, 0);
        const slot = currentSlot;
        // Ease the tile into its slot first, then commit — the committed
        // layout matches the settled transforms, so the swap is invisible.
        projectSettleRef.current = true;
        setProjectDrag({
          id: projectId,
          fromCluster,
          targetCluster: slot.cluster,
          delta: slot.top - draggedRect.top,
          shifts: shiftsFor(slot),
          settling: true,
        });
        window.setTimeout(() => {
          projectSettleRef.current = false;
          setProjectDrag(null);
          if (slot === homeSlot) return;
          const otherTiles = rows
            .filter((row, i) => row.kind === "tile" && i !== fromRow)
            .map((row) => row.key);
          const nextOrder = [
            ...otherTiles.slice(0, slot.flatIndex),
            projectId,
            ...otherTiles.slice(slot.flatIndex),
          ];
          const groupChanged = slot.cluster !== fromCluster;
          void persistProjectOrder(
            nextOrder,
            groupChanged
              ? { projectId, groupId: slot.cluster === "ungrouped" ? null : slot.cluster }
              : null,
          );
        }, GROUP_SETTLE_MS);
      };
      const onCancel = (cancelEvent: PointerEvent) => {
        if (cancelEvent.pointerId !== event.pointerId) return;
        cleanup();
        setProjectDrag(null);
      };

      window.addEventListener("pointermove", onMove, { passive: false });
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onCancel);
    },
    [clearHoverLabel, persistProjectOrder],
  );

  const movePinnedProjectByKeyboard = useCallback(
    (projectId: string, direction: -1 | 1) => {
      if (reorderSavingRef.current) return;
      const currentOrder = [...pinnedIdsRef.current];
      const fromIndex = currentOrder.indexOf(projectId);
      if (fromIndex < 0) return;
      const toIndex = Math.max(0, Math.min(currentOrder.length - 1, fromIndex + direction));
      if (fromIndex === toIndex) return;
      void persistProjectOrder(reorderPinnedIds(currentOrder, fromIndex, toIndex), null);
    },
    [persistProjectOrder],
  );

  const persistGroupOrder = useCallback(
    async (nextOrder: string[]) => {
      const serverIds = groups.map((group) => group.id);
      if (nextOrder.join("\0") === serverIds.join("\0")) {
        setGroupDragOrder(null);
        groupDragOrderRef.current = null;
        return;
      }
      setGroupDragOrder(nextOrder);
      groupDragOrderRef.current = nextOrder;
      groupReorderSavingRef.current = true;
      const previous = queryClient.getQueryData<Group[]>(queryKeys.groups);
      const byId = new Map((previous ?? groups).map((group) => [group.id, group]));
      queryClient.setQueryData<Group[]>(
        queryKeys.groups,
        nextOrder.flatMap((id) => {
          const group = byId.get(id);
          return group ? [group] : [];
        }),
      );
      try {
        const { groups: updated } = await api.reorderGroups(nextOrder);
        queryClient.setQueryData(queryKeys.groups, updated);
      } catch (error) {
        queryClient.setQueryData(queryKeys.groups, previous);
        setGroupDragOrder(null);
        groupDragOrderRef.current = null;
        toast.error(error instanceof Error ? error.message : "Could not reorder groups");
      } finally {
        groupReorderSavingRef.current = false;
      }
    },
    [groups, queryClient],
  );

  const startGroupPointerDrag = useCallback(
    (groupId: string, event: ReactPointerEvent<HTMLButtonElement>) => {
      if (event.button !== 0) return;
      if (groupReorderSavingRef.current || groupSettleRef.current || projectSettleRef.current) return;
      event.stopPropagation();
      clearHoverLabel();
      const startX = event.clientX;
      const startY = event.clientY;
      // Freeze the geometry once: each visible cluster's extent (header top →
      // last tile bottom) in the order it renders right now. All drop math runs
      // against this snapshot and the DOM order never changes mid-drag, so the
      // targets can't move under the pointer (the old live-reorder feedback
      // loop that made clusters jump between slots).
      const bar = barRef.current;
      const handles = Array.from(bar?.querySelectorAll<HTMLElement>("[data-group-handle]") ?? []);
      const rects = handles.flatMap((handleEl) => {
        const id = handleEl.dataset.groupId;
        if (!id) return [];
        const head = handleEl.getBoundingClientRect();
        let bottom = head.bottom;
        bar
          ?.querySelectorAll<HTMLElement>(`[data-cluster-id="${CSS.escape(id)}"]`)
          .forEach((tile) => {
            bottom = Math.max(bottom, tile.getBoundingClientRect().bottom);
          });
        return [{ id, top: head.top, height: bottom - head.top }];
      });
      const fromVis = rects.findIndex((rect) => rect.id === groupId);
      if (fromVis < 0 || rects.length < 2) return;
      const draggedRect = rects[fromVis]!;
      const blockShift = draggedRect.height + GAP;
      // The block can only travel within the reorderable range — it can't be
      // dragged above the first group, below the last one, or over Ungrouped
      // (which has no handle and no slot).
      const lastRect = rects[rects.length - 1]!;
      const minDelta = rects[0]!.top - draggedRect.top;
      const maxDelta = lastRect.top + lastRect.height - (draggedRect.top + draggedRect.height);
      const handle = event.currentTarget;
      handle.setPointerCapture(event.pointerId);
      let moved = false;
      let toVis = fromVis;

      const shiftsFor = (targetVis: number) => {
        // Clusters between the old slot and the new one slide one block-height
        // out of the way; everything else stays put.
        const shifts: Record<string, number> = {};
        if (targetVis > fromVis) {
          for (let i = fromVis + 1; i <= targetVis; i++) shifts[rects[i]!.id] = -blockShift;
        } else {
          for (let i = targetVis; i < fromVis; i++) shifts[rects[i]!.id] = blockShift;
        }
        return shifts;
      };

      const onMove = (moveEvent: PointerEvent) => {
        if (moveEvent.pointerId !== event.pointerId) return;
        if (!moved && Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) < DRAG_THRESHOLD_PX) {
          return;
        }
        moved = true;
        const delta = Math.max(minDelta, Math.min(maxDelta, moveEvent.clientY - startY));
        // Target slot: a cluster ABOVE the origin is passed once the block's
        // TOP edge rises above its (frozen) midpoint; one BELOW once the
        // block's BOTTOM edge sinks below it. Edge-based rather than
        // center-based so a tall block can still clear a short first/last
        // cluster inside the clamped travel range — the center of a tall
        // block can never cross a short edge cluster's midpoint, which made
        // drags stick one slot from the ends. Still monotonic in the pointer
        // position, so the choice can't oscillate.
        const topY = draggedRect.top + delta;
        const bottomY = topY + draggedRect.height;
        toVis = 0;
        for (let i = 0; i < rects.length; i++) {
          if (i === fromVis) continue;
          const mid = rects[i]!.top + rects[i]!.height / 2;
          if (i < fromVis ? topY > mid : bottomY > mid) toVis++;
        }
        setGroupDrag({ id: groupId, delta, shifts: shiftsFor(toVis), settling: false });
        moveEvent.preventDefault();
      };

      const cleanup = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onCancel);
        if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
      };

      const settleThenCommit = (nextOrder: string[] | null) => {
        // Ease the block into its exact final slot first, then commit the
        // reorder — the committed layout matches the settled transforms
        // pixel-for-pixel, so the DOM swap is invisible.
        const settleDelta =
          toVis === fromVis
            ? 0
            : toVis > fromVis
              ? rects[toVis]!.top + rects[toVis]!.height - (draggedRect.top + draggedRect.height)
              : rects[toVis]!.top - draggedRect.top;
        groupSettleRef.current = true;
        setGroupDrag({ id: groupId, delta: settleDelta, shifts: shiftsFor(toVis), settling: true });
        window.setTimeout(() => {
          groupSettleRef.current = false;
          setGroupDrag(null);
          if (nextOrder) void persistGroupOrder(nextOrder);
        }, GROUP_SETTLE_MS);
      };

      const onUp = (upEvent: PointerEvent) => {
        if (upEvent.pointerId !== event.pointerId) return;
        cleanup();
        if (!moved) {
          setGroupDrag(null);
          return;
        }
        upEvent.preventDefault();
        if (toVis === fromVis) {
          settleThenCommit(null);
          return;
        }
        // Map the visible slot back onto the persisted group order and drop the
        // cluster into the target group's spot. Empty groups are visible here,
        // so they can be reordered just like groups with pinned projects.
        const fullOrder = groupDragOrderRef.current ?? groups.map((group) => group.id);
        const from = fullOrder.indexOf(groupId);
        const to = fullOrder.indexOf(rects[toVis]!.id);
        settleThenCommit(from >= 0 && to >= 0 ? reorderPinnedIds(fullOrder, from, to) : null);
      };
      const onCancel = (cancelEvent: PointerEvent) => {
        if (cancelEvent.pointerId !== event.pointerId) return;
        cleanup();
        setGroupDrag(null);
      };

      window.addEventListener("pointermove", onMove, { passive: false });
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onCancel);
    },
    [clearHoverLabel, groups, persistGroupOrder],
  );

  const moveGroupByKeyboard = useCallback(
    (groupId: string, direction: -1 | 1) => {
      if (groupReorderSavingRef.current) return;
      const current = groupDragOrderRef.current ?? groups.map((group) => group.id);
      const from = current.indexOf(groupId);
      if (from < 0) return;
      const to = Math.max(0, Math.min(current.length - 1, from + direction));
      if (from === to) return;
      void persistGroupOrder(reorderPinnedIds(current, from, to));
    },
    [groups, persistGroupOrder],
  );

  // In All mode, real groups remain useful even without pinned projects: their
  // headers are stable project drop targets. The scoped rail still disappears
  // when the selected group has no projects because there is nothing to move
  // into it from that isolated view.
  if (railClusters.length === 0) return null;

  const activeId = router.state.location.pathname.match(/^\/projects\/([^/]+)/)?.[1];
  const activeIndex = visible.findIndex((p) => p.id === activeId);

  // In "All" mode each cluster is preceded by a group-number label (the first
  // digit of the Cmd chord). Labels stay up during drags — a project drag
  // moves tiles between the visible groups.
  const showClusterLabels = !groupScoped;
  const PAD_TOP = minimal ? 18 : 12;
  const PAD_X = minimal ? 4 : 8;
  const BAR_WIDTH = minimal ? 72 : 96;
  const IDLE_ITEM_WIDTH = ITEM_HEIGHT;
  const ITEM_RADIUS = minimal ? 9 : 10;
  const HOTKEY_BADGE_RADIUS = minimal ? 0 : 4;
  const activeProject = activeIndex >= 0 ? visible[activeIndex] : null;
  const activeStatusDots = activeProject
    ? getPinnedProjectStatusDots(activeProject.taskCounts)
    : [];
  const activeItemWidth =
    activeProject && activeStatusDots.length > 0 ? ITEM_WIDTH : IDLE_ITEM_WIDTH;
  // The highlight ring rides along with whichever cluster holds the selected
  // tile — glued to the pointer if that cluster is being dragged, easing aside
  // with it if it's displaced.
  const activeCluster = activeProject
    ? railClusters.find((cl) => cl.projects.some((p) => p.id === activeProject.id)) ?? null
    : null;
  const activeDragOffset =
    groupDrag && activeCluster
      ? activeCluster.key === groupDrag.id
        ? groupDrag.delta
        : groupDrag.shifts[activeCluster.key] ?? 0
      : projectDrag && activeProject
        ? activeProject.id === projectDrag.id
          ? projectDrag.delta
          : projectDrag.shifts[activeProject.id] ?? 0
        : 0;
  const activeOverlayGlued =
    (groupDrag != null && !groupDrag.settling && activeCluster?.key === groupDrag.id) ||
    (projectDrag != null && !projectDrag.settling && activeProject?.id === projectDrag.id);

  // Y offset of each tile inside the rail — dividers and the group header
  // shift everything below them, so the active-highlight overlay can't just
  // multiply by index anymore.
  const itemOffsets: number[] = [];
  {
    let y = 0;
    if (groupScoped) y += HEADER_HEIGHT + GAP;
    railClusters.forEach((cluster, clusterIndex) => {
      if (showClusterLabels) y += GROUP_LABEL_HEIGHT + GAP;
      else if (clusterIndex > 0) y += DIVIDER_HEIGHT + GAP;
      for (let i = 0; i < cluster.projects.length; i++) {
        itemOffsets.push(y);
        y += ITEM_HEIGHT + GAP;
      }
    });
  }
  const flatIndexById = new Map(visible.map((project, index) => [project.id, index]));
  const railLabel = groupScoped ? (railClusters[0]?.label ?? "Group") : "Pinned projects";
  const railColor = groupScoped ? railClusters[0]?.color : null;

  const menuProject = menu ? visibleById.get(menu.id) ?? null : null;

  return (
    <>
    <CardFrame
      ref={barRef}
      glow
      role="navigation"
      className="mc-project-rail"
      aria-label={groupScoped ? `${railLabel} projects` : "Pinned projects"}
      aria-disabled={disabled || undefined}
      onMouseLeave={clearHoverLabel}
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
        // Inert + dimmed while the active sandbox resumes — its projects aren't
        // usable until the agent is back.
        opacity: disabled ? 0.5 : undefined,
        pointerEvents: disabled ? "none" : undefined,
        transition: "opacity 0.15s",
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
            transform: `translateY(${(itemOffsets[activeIndex] ?? 0) + activeDragOffset}px)`,
            transition: activeOverlayGlued
              ? "none"
              : groupDrag || projectDrag
                ? `transform ${GROUP_SETTLE_MS}ms ${GROUP_SETTLE_EASE}`
                : "transform 0.25s cubic-bezier(0.4, 0, 0.2, 1)",
            pointerEvents: "none",
            zIndex: 2,
          }}
        />
      )}
      {groupScoped && (
        <div
          title={`Rail scoped to ${railLabel}`}
          style={{
            height: HEADER_HEIGHT,
            maxWidth: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 4,
            flexShrink: 0,
            padding: "0 2px",
          }}
        >
          <span
            aria-hidden
            style={{
              width: 7,
              height: 7,
              borderRadius: "50%",
              background: railColor ?? "var(--text-faint)",
              boxShadow: railColor ? `0 0 6px ${railColor}66` : undefined,
              flexShrink: 0,
            }}
          />
          <span
            style={{
              fontFamily: "var(--mono)",
              fontSize: 8.5,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              color: "var(--text-faint)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {railLabel}
          </span>
        </div>
      )}
      {railClusters.map((cluster, clusterIndex) => {
        // During a GROUP drag every element of a cluster (header + tiles)
        // translates by the same offset, so groups move as rigid blocks: the
        // grabbed one glued to the pointer (no transition), displaced ones
        // easing aside, and the drop settling with the same ease before the
        // reorder commits.
        const isDragCluster = groupDrag?.id === cluster.key;
        const clusterOffset = groupDrag
          ? isDragCluster
            ? groupDrag.delta
            : groupDrag.shifts[cluster.key] ?? 0
          : 0;
        // During a PROJECT drag rows move individually — the header takes its
        // own shift from the drag's shift map.
        const headerOffset = groupDrag
          ? clusterOffset
          : projectDrag
            ? projectDrag.shifts[`hdr:${cluster.key}`] ?? 0
            : 0;
        // Cluster whose slot the dragged tile currently hovers — its header
        // lights up so it's clear which group would receive the project.
        const isDropTarget = projectDrag != null && projectDrag.targetCluster === cluster.key;
        const clusterMoveTransition =
          groupDrag != null
            ? isDragCluster && !groupDrag.settling
              ? null
              : `transform ${GROUP_SETTLE_MS}ms ${GROUP_SETTLE_EASE}`
            : projectDrag != null
              ? `transform ${GROUP_SETTLE_MS}ms ${GROUP_SETTLE_EASE}`
              : null;
        return (
        <Fragment key={cluster.key}>
          {showClusterLabels ? (
            (() => {
              const isUngrouped = cluster.key === "ungrouped";
              const isEmpty = cluster.projects.length === 0;
              const isDraggingGroup = isDragCluster;
              const c = cluster.color;
              const headerTitle = isUngrouped
                ? `${cluster.label} — group ${clusterIndex + 1} (⌘${clusterIndex + 1} then a project number)`
                : `${cluster.label} — group ${clusterIndex + 1} (⌘${clusterIndex + 1} then a project number)${isEmpty ? " — empty; drag a project here" : ""} — drag or press Shift+Arrow Up/Down to reorder groups`;
              // The group number is the ⌘-chord key, so it wears a keycap: a
              // group-tinted chip that reads as a shortcut and stays role-distinct
              // from the neutral hotkey badges on the tiles below.
              const keycap = (
                <span
                  aria-hidden
                  style={{
                    display: "grid",
                    placeItems: "center",
                    flexShrink: 0,
                    width: 16,
                    height: 15,
                    borderRadius: 4,
                    fontFamily: "var(--mono)",
                    fontSize: 9.5,
                    fontWeight: 700,
                    lineHeight: 1,
                    fontVariantNumeric: "tabular-nums",
                    background: c ? `color-mix(in srgb, ${c} 20%, transparent)` : "var(--surface-3)",
                    border: `1px solid ${c ? `color-mix(in srgb, ${c} 50%, transparent)` : "var(--border)"}`,
                    color: c ? `color-mix(in srgb, ${c} 78%, var(--text))` : "var(--text-dim)",
                  }}
                >
                  {clusterIndex + 1}
                </span>
              );
              const nameLabel = (
                <span
                  style={{
                    fontFamily: "var(--mono)",
                    fontSize: 9.5,
                    fontWeight: 650,
                    letterSpacing: "0.02em",
                    color: c ? `color-mix(in srgb, ${c} 68%, var(--text))` : "var(--text-dim)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {shortGroupName(cluster.label)}
                </span>
              );
              if (isUngrouped) {
                return (
                  <div
                    data-cluster-header={cluster.key}
                    title={headerTitle}
                    style={{
                      height: GROUP_LABEL_HEIGHT,
                      width: "100%",
                      maxWidth: "100%",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 5,
                      flexShrink: 0,
                      padding: "0 6px",
                      borderRadius: 6,
                      transform: `translateY(${headerOffset}px)`,
                      background: isDropTarget
                        ? "color-mix(in srgb, var(--surface-3) 70%, var(--surface-2))"
                        : undefined,
                      boxShadow: isDropTarget
                        ? "inset 0 0 0 1px var(--border-strong)"
                        : undefined,
                      transition: [
                        "background 140ms ease",
                        "box-shadow 140ms ease",
                        ...(clusterMoveTransition ? [clusterMoveTransition] : []),
                      ].join(", "),
                    }}
                  >
                    {keycap}
                    {nameLabel}
                  </div>
                );
              }
              return (
                <button
                  type="button"
                  data-group-handle
                  data-group-id={cluster.key}
                  data-cluster-header={cluster.key}
                  title={headerTitle}
                  aria-label={headerTitle}
                  aria-keyshortcuts="Shift+ArrowUp Shift+ArrowDown"
                  className="mc-group-header"
                  onPointerDown={(e) => {
                    if (disabled) return;
                    startGroupPointerDrag(cluster.key, e);
                  }}
                  onDragStart={(e) => e.preventDefault()}
                  onKeyDown={(e) => {
                    if (disabled) return;
                    if (!e.shiftKey || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
                    e.preventDefault();
                    moveGroupByKeyboard(cluster.key, e.key === "ArrowUp" ? -1 : 1);
                  }}
                  style={{
                    position: "relative",
                    appearance: "none",
                    border: 0,
                    margin: 0,
                    height: GROUP_LABEL_HEIGHT,
                    width: "100%",
                    maxWidth: "100%",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 5,
                    flexShrink: 0,
                    padding: "0 6px",
                    borderRadius: 6,
                    cursor: isDraggingGroup ? "grabbing" : "grab",
                    touchAction: "none",
                    userSelect: "none",
                    ["WebkitUserDrag" as any]: "none",
                    // The lift (fill + group-color glow) marks the header as
                    // "picked up"; the drop-target tint marks the group a
                    // dragged project would land in.
                    transform: `translateY(${headerOffset}px)`,
                    background: isDraggingGroup
                      ? `color-mix(in srgb, ${c ?? "var(--surface-3)"} 24%, var(--surface-2))`
                      : isDropTarget
                        ? `color-mix(in srgb, ${c ?? "var(--surface-3)"} 16%, var(--surface-2))`
                        : undefined,
                    boxShadow: isDraggingGroup
                      ? `0 8px 20px -6px color-mix(in srgb, ${c ?? "#000"} 60%, transparent)`
                      : isDropTarget
                        ? `inset 0 0 0 1px ${c ? `color-mix(in srgb, ${c} 55%, transparent)` : "var(--border-strong)"}`
                        : undefined,
                    zIndex: isDraggingGroup ? 6 : undefined,
                    willChange: "transform",
                    transition: [
                      "background 140ms ease",
                      "box-shadow 160ms ease",
                      ...(clusterMoveTransition ? [clusterMoveTransition] : []),
                    ].join(", "),
                  }}
                >
                  <span
                    aria-hidden
                    className="mc-group-header__grip"
                    style={{
                      position: "absolute",
                      left: 3,
                      top: "50%",
                      transform: "translateY(-50%)",
                      display: "grid",
                      gridTemplateColumns: "repeat(2, 2px)",
                      gap: 2,
                      flexShrink: 0,
                    }}
                  >
                    {Array.from({ length: 6 }).map((_, dot) => (
                      <span
                        key={dot}
                        style={{
                          width: 2,
                          height: 2,
                          borderRadius: "50%",
                          background: c
                            ? `color-mix(in srgb, ${c} 70%, var(--text-faint))`
                            : "var(--text-faint)",
                        }}
                      />
                    ))}
                  </span>
                  {keycap}
                  {nameLabel}
                </button>
              );
            })()
          ) : (
            clusterIndex > 0 && (
              <div
                role="separator"
                aria-orientation="horizontal"
                aria-label={cluster.label}
                title={cluster.label}
                style={{
                  width: 34,
                  height: DIVIDER_HEIGHT,
                  borderRadius: 2,
                  background: cluster.color ?? "var(--border-strong)",
                  opacity: 0.55,
                  flexShrink: 0,
                }}
              />
            )
          )}
          {cluster.projects.map((project, projectIndex) => {
        const idx = flatIndexById.get(project.id)!;
        const isActive = idx === activeIndex;
        // Per-group project number (restarts each cluster). The group number
        // is clusterIndex + 1, shown on the label above.
        const projectNumber = projectIndex + 1;
        const groupNumber = clusterIndex + 1;
        const hotkey = projectNumber <= HOTKEY_LIMIT ? projectNumber : null;
        const chordHint = groupScoped
          ? pinnedSlotBinding(projectNumber)
          : `${pinnedSlotBinding(groupNumber)} ${projectNumber}`;
        const runningCount = project.taskCounts.running;
        const launchRunning = hasRunningLaunchForProject(project.id, project.launchCommands);
        const logoShouldFlash = shouldFlashPinnedProjectLogo({
          cliRunningCount: runningCount,
          terminalOpen: launchRunning,
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
        const launchLabel = launchRunning ? "launch running" : null;
        const finishedLabel =
          finishedCount > 0
            ? `${finishedCount} ${finishedCount === 1 ? "session" : "sessions"} finished`
            : null;
        const tooltip = [
          hotkey ? `${project.name} (${chordHint})` : project.name,
          groupScoped ? null : "Drag or press Shift+Arrow Up/Down to reorder pinned projects",
          needsInputLabel,
          launchLabel,
          runningLabel,
          finishedLabel,
        ]
          .filter(Boolean)
          .join(" — ");
        const isDragging = projectDrag?.id === project.id;
        // While its group is being dragged, a tile rides along with the header
        // as part of the same rigid block.
        const clusterDragging = isDragCluster;
        // Row offset: rigid cluster block during a group drag; per-row shift
        // (or the pointer-glued delta) during a project drag.
        const tileOffset = groupDrag
          ? clusterOffset
          : projectDrag
            ? isDragging
              ? projectDrag.delta
              : projectDrag.shifts[project.id] ?? 0
            : 0;
        const tileGlued =
          (groupDrag != null && isDragCluster && !groupDrag.settling) ||
          (projectDrag != null && isDragging && !projectDrag.settling);
        const tileMoveTransition = tileGlued ? null : clusterMoveTransition;
        return (
          <button
            key={project.id}
            type="button"
            data-pinned-item={groupScoped ? undefined : true}
            data-cluster-id={cluster.key}
            data-project-id={project.id}
            title={tooltip}
            aria-label={tooltip}
            aria-keyshortcuts={groupScoped ? undefined : "Shift+ArrowUp Shift+ArrowDown"}
            onPointerDown={(e) => {
              // Group-workspace mode has a computed order (pinned first, then
              // alphabetical) — manual reorder only applies to the pinned rail.
              if (!groupScoped) startProjectPointerDrag(project.id, e);
            }}
            onDragStart={(e) => e.preventDefault()}
            onMouseEnter={(e) => {
              if (disabled || projectDrag || groupDrag) return;
              showHoverLabel(project.name, e);
            }}
            onKeyDown={(e) => {
              if (disabled || groupScoped) return;
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
            className="mc-pinned-tile"
            style={{
              position: "relative",
              width: hasStatusDots ? ITEM_WIDTH : IDLE_ITEM_WIDTH,
              height: ITEM_HEIGHT,
              flexShrink: 0,
              padding: hasStatusDots ? "4px 6px 4px 14px" : 4,
              borderRadius: ITEM_RADIUS,
              zIndex: isDragging ? 6 : isActive ? 3 : clusterDragging ? 5 : 1,
              cursor: clusterDragging
                ? "grabbing"
                : groupScoped
                  ? "pointer"
                  : reorderSaving
                    ? "default"
                    : isDragging
                      ? "grabbing"
                      : "grab",
              opacity: isDragging ? 0.92 : 1,
              transform: `translateY(${tileOffset}px)`,
              boxShadow: isDragging
                ? "0 0 0 2px color-mix(in srgb, var(--accent) 70%, white), 0 10px 24px -10px rgba(0, 0, 0, 0.6)"
                : clusterDragging
                  ? "0 8px 18px -8px rgba(0, 0, 0, 0.55)"
                  : undefined,
              // Keep the tile's own hover transitions (from .mc-pinned-tile);
              // transform eases only while displaced/settling — never while
              // glued to the pointer, and not on the post-settle commit render
              // (the layout swap there is a visual no-op).
              transition: [
                "background 120ms ease",
                "border-color 150ms ease",
                ...(tileMoveTransition ? [tileMoveTransition] : []),
              ].join(", "),
              touchAction: "none",
              userSelect: "none",
              ["WebkitUserDrag" as any]: "none",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
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
                    color: "var(--accent-ink)",
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
                className="mc-project-hotkey-badge"
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
        </Fragment>
        );
      })}
      {menu && (
        <ContextMenuPopover anchor={menu} label={`${menu.name} actions`} minWidth={196}>
            <DropdownMenuItem
              icon="settings"
              autoFocus
              onClick={() => {
                if (!menuProject) return;
                setMenu(null);
                setEditingProject(menuProject);
              }}
            >
              Edit project
            </DropdownMenuItem>
            <DropdownMenuItem
              icon="pin-fill"
              onClick={async () => {
                const id = menu.id;
                setMenu(null);
                await api.togglePin(id);
                await Promise.all([invalidateProjects(), invalidateProject(id)]);
              }}
            >
              {menuProject?.pinned === false ? "Pin project" : "Unpin project"}
            </DropdownMenuItem>
        </ContextMenuPopover>
      )}
    </CardFrame>
    {hoverLabel &&
      !projectDrag &&
      !groupDrag &&
      createPortal(
        <div
          className="mc-project-hover-label"
          style={{ top: hoverLabel.top, left: hoverLabel.left }}
        >
          {hoverLabel.name}
        </div>,
        document.body,
      )}
    {editingProject && (
      <ProjectDialog
        open
        project={editingProject}
        groups={groups}
        onCreateGroup={createGroupForSelection}
        onClose={() => setEditingProject(null)}
        onSave={async (data) => {
          const projectId = editingProject.id;
          await api.updateProject(projectId, data);
          setEditingProject(null);
          await Promise.all([invalidateProjects(), invalidateProject(projectId)]);
        }}
      />
    )}
    </>
  );
});
