import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CardFrame } from "~/components/ui/CardFrame";
import { ConfirmDialog } from "~/components/ui/ConfirmDialog";
import { archiveOpenSession } from "~/lib/archive-session";
import { GRID_EXPAND_TOGGLE_EVENT } from "~/lib/design-meta";
import { getElectron, isElectron } from "~/lib/electron";
import { matchBinding } from "~/lib/keybindings/match";
import { useKeybindings } from "~/lib/keybindings/store";
import { reorderPinnedIds } from "~/lib/pinned-project-order";
import { isSettingsOverlayOpen } from "~/lib/settings-navigation";
import { isUserTerminalXtermFocused } from "~/lib/terminal-pane-helpers";
import { terminalSurfaceCache } from "~/lib/terminal-surface-cache";
import {
  terminalSurfaceIdForProject,
  useTerminals,
  type OpenTerminal,
} from "~/lib/terminal-store";
import { isEditableTarget, useHotkey } from "~/lib/use-hotkey";
import { useUserTerminals } from "~/lib/user-terminal-store";
import { queryKeys } from "~/queries";
import { LOCAL_SCOPE_ID } from "~/shared/sandbox";
import { worktreeScopeKey } from "~/shared/worktrees";
import { TerminalPane } from "./TerminalPane";
import type { Task } from "~/db/schema";

const GRID_ORDER_KEY = "mc.gridOrder";
const GRID_RESIZE_KEY = "mc.gridResize";
const DRAG_THRESHOLD_PX = 4;
// Cell gap / outer padding of the grid (kept in sync with the container style
// below) — the resize math needs them to place divider handles precisely.
const GRID_GAP = 8;
const GRID_PADDING = 8;
// Hit area for a divider handle — exactly the cell gap, so the invisible
// handles (zIndex above the cells) never overhang the terminal surfaces and
// steal pointerdowns near a cell's inner edge.
const HANDLE_HIT = GRID_GAP;
// Cards glide between grid slots on reorder — same timing/easing as the
// sidebar's pinned-project slide so the two motions feel related.
const FLIP_ID = "grid-cell-flip";
const FLIP_DURATION_MS = 140;
const FLIP_EASING = "cubic-bezier(0.4, 0, 0.2, 1)";
// Panes without a cached xterm surface mount this many more per frame, so
// entering a grid of fresh sessions paints the route immediately instead of
// committing every heavy TerminalPane tree at once. Cached surfaces reattach
// instantly and skip the ramp entirely (returning to the grid stays instant).
const PANE_MOUNTS_PER_FRAME = 2;
// Each track can't be dragged narrower than this (px) so a cell never vanishes.
const MIN_CELL_PX = 80;

function loadGridOrder(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(GRID_ORDER_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function saveGridOrder(ids: string[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(GRID_ORDER_KEY, JSON.stringify(ids));
  } catch {
    /* quota or disabled */
  }
}

/** Track sizes (in `fr` units) per grid shape, keyed by `${cols}x${rows}`, so a
 *  resized layout survives reloads and returns when the same shape recurs. */
type GridResizeMap = Record<string, { cols: number[]; rows: number[] }>;

/** Positive finite track weights, or null when the stored entry is malformed. */
function sanitizeTracks(value: unknown): number[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  return value.every((n) => typeof n === "number" && Number.isFinite(n) && n > 0)
    ? (value as number[])
    : null;
}

function loadGridResize(): GridResizeMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(GRID_RESIZE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    // Validate entry-by-entry: a corrupted or legacy shape must degrade to the
    // equal-weight default, not crash the grid (makeSizes trusts these arrays).
    const map: GridResizeMap = {};
    for (const [shape, entry] of Object.entries(parsed as Record<string, unknown>)) {
      if (!entry || typeof entry !== "object") continue;
      const cols = sanitizeTracks((entry as { cols?: unknown }).cols);
      const rows = sanitizeTracks((entry as { rows?: unknown }).rows);
      if (cols && rows) map[shape] = { cols, rows };
    }
    return map;
  } catch {
    return {};
  }
}

function saveGridResize(map: GridResizeMap): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(GRID_RESIZE_KEY, JSON.stringify(map));
  } catch {
    /* quota or disabled */
  }
}

/** Column spans for the cards in the final (partial) row so they fill the full
 *  grid width, divided as evenly as possible. Returns null when the last row is
 *  already full (nothing to stretch). e.g. 2 cards across 4 columns → [2, 2]. */
function lastRowColumnSpans(count: number, columns: number): number[] | null {
  if (count <= 0 || count >= columns) return null;
  const base = Math.floor(columns / count);
  const extra = columns % count;
  return Array.from({ length: count }, (_, i) => base + (i < extra ? 1 : 0));
}

/** Explicit 1-based grid position for a cell, mirroring the default auto-flow
 *  layout exactly. Pinning every cell lets an expanded cell span the whole grid
 *  (gridColumn/Row "1 / -1") and overlay the others without auto-placement
 *  reshuffling — and therefore resizing — its hidden siblings. */
function cellPlacement(
  index: number,
  columns: number,
  rows: number,
  lastRowStart: number,
  lastRowSpans: number[] | null,
): { colStart: number; colSpan: number; rowStart: number } {
  if (lastRowSpans && index >= lastRowStart) {
    const spanIndex = index - lastRowStart;
    let colStart = 1;
    for (let k = 0; k < spanIndex; k++) colStart += lastRowSpans[k]!;
    return { colStart, colSpan: lastRowSpans[spanIndex]!, rowStart: rows };
  }
  return {
    colStart: (index % columns) + 1,
    colSpan: 1,
    rowStart: Math.floor(index / columns) + 1,
  };
}

/** A valid, length-matched size array (from storage) or an equal-weight default. */
function makeSizes(stored: number[] | undefined, len: number): number[] {
  if (
    Array.isArray(stored) &&
    stored.length === len &&
    stored.every((n) => Number.isFinite(n) && n > 0)
  ) {
    return stored.slice();
  }
  return Array<number>(len).fill(1);
}

/** Surface/scope key for a session — mirrors TerminalPanel so the grid reuses
 *  the same cached xterm surface (and live PTY) as the single-panel view. */
function scopeKeyFor(session: OpenTerminal): string {
  return `${worktreeScopeKey(session.project.id, session.project.activeWorktreeId)}:${
    session.project.activeRuntimeScopeId ?? LOCAL_SCOPE_ID
  }`;
}

type PointerDragState = {
  id: string;
  pointerId: number;
  startX: number;
  startY: number;
  moved: boolean;
};

/** True when a real input owns focus — a dialog field, the search box, or the
 *  bottom user terminal — as opposed to a session terminal inside the grid,
 *  which is the intended place to trigger keyboard-nav from. Keeps Cmd/Ctrl+G
 *  out of the way of anything the user is actively typing into. */
function isNonGridTerminalEditableFocused(): boolean {
  const el = document.activeElement;
  if (!isEditableTarget(el)) return false;
  return !(
    el instanceof HTMLElement &&
    el.classList.contains("xterm-helper-textarea") &&
    el.closest("[data-grid-cell]") !== null
  );
}

type GridCellProps = {
  session: OpenTerminal;
  scopeKey: string;
  /** False while this cell's pane mount is deferred (progressive first mount);
   *  the cell renders as an empty frame holding its grid slot. */
  mounted: boolean;
  expanded: boolean;
  /** True when another cell is expanded and this one is overlaid/hidden. */
  hidden: boolean;
  isDragging: boolean;
  isFocused: boolean;
  isNavSelected: boolean;
  navActive: boolean;
  /** Explicit grid placement (an expanded cell spans the whole grid). */
  gridColumn: string;
  gridRow: string;
  reorderEnabled: boolean;
  onToggleExpanded: (taskId: string) => void;
  onRequestClose: (session: OpenTerminal) => void;
  onPtyReady: (taskId: string, ptyId: string | null, scopeKey: string) => void;
  onHeaderPointerDown: (taskId: string, event: ReactPointerEvent<HTMLDivElement>) => void;
};

/** One grid cell (its terminal), memoized so a per-grid state change — moving
 *  the keyboard-nav highlight, a spotlight, a drag — only re-renders the cells
 *  whose props actually changed instead of every open terminal pane. The parent
 *  passes stable callbacks so the memo holds across nav-move renders. */
const GridCell = memo(function GridCell({
  session,
  scopeKey,
  mounted,
  expanded,
  hidden,
  isDragging,
  isFocused,
  isNavSelected,
  navActive,
  gridColumn,
  gridRow,
  reorderEnabled,
  onToggleExpanded,
  onRequestClose,
  onPtyReady,
  onHeaderPointerDown,
}: GridCellProps) {
  return (
    <CardFrame
      data-grid-cell
      data-task-id={session.taskId}
      aria-current={isNavSelected ? "true" : undefined}
      style={{
        display: "flex",
        flexDirection: "column",
        minWidth: 0,
        minHeight: 0,
        gridColumn,
        gridRow,
        overflow: "hidden",
        // A cell hidden behind an expanded sibling keeps its grid slot (and pixel
        // size — so its terminal never refits), it's just not painted or hit.
        visibility: hidden ? "hidden" : undefined,
        pointerEvents: hidden ? "none" : undefined,
        // Dim the unselected cells while navigating to spotlight the pick — but
        // never dim a cell being spotlighted by a notification "Open".
        opacity: navActive && !isNavSelected && !isFocused ? 0.4 : isDragging ? 0.9 : 1,
        outline:
          isDragging || isFocused || isNavSelected ? "2px solid var(--accent)" : undefined,
        outlineOffset: isDragging || isFocused || isNavSelected ? -2 : undefined,
        // The expanded cell floats above its (hidden) siblings; while held, a card
        // floats with a lift shadow as it tracks the pointer; the nav selection
        // sits above its dimmed neighbours so its ring/glow isn't clipped.
        zIndex: expanded ? 8 : isDragging ? 5 : isNavSelected ? 4 : undefined,
        boxShadow: isDragging
          ? "0 16px 40px rgba(0, 0, 0, 0.5)"
          : isFocused || isNavSelected
            ? "0 0 22px var(--accent-glow)"
            : undefined,
        transition: "opacity 120ms ease, box-shadow 200ms ease",
      }}
    >
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          minHeight: 0,
          overflow: "hidden",
        }}
      >
        {mounted && (
          <TerminalPane
            project={session.project}
            task={session.task}
            descriptor={session}
            isLast
            expanded={expanded}
            onToggleExpanded={() => onToggleExpanded(session.taskId)}
            onHide={() => onRequestClose(session)}
            onPtyReady={(ptyId) => onPtyReady(session.taskId, ptyId, scopeKey)}
            onHeaderPointerDown={
              reorderEnabled ? (e) => onHeaderPointerDown(session.taskId, e) : undefined
            }
            headerGrabbing={isDragging}
          />
        )}
      </div>
    </CardFrame>
  );
});

/**
 * Full-width grid of every open session across all projects/worktrees. Each
 * cell reuses TerminalPane (which carries its own title header + expand/close
 * controls). Expanding a cell fills the grid; closing archives the session.
 * Cards can be reordered by dragging the handle rail at the top of each cell;
 * the order is persisted to localStorage.
 */
export function SessionGrid() {
  const { sessions, close, setPtyId, gridFocusRequest } = useTerminals();
  const queryClient = useQueryClient();
  const userTerminals = useUserTerminals();
  const { bindings } = useKeybindings();
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);
  // Task whose cell is momentarily spotlighted after a notification "Open".
  const [focusedTaskId, setFocusedTaskId] = useState<string | null>(null);
  // Keyboard-navigation mode (Cmd/Ctrl+G): the selected cell, or null when off.
  const [navTaskId, setNavTaskId] = useState<string | null>(null);
  const [pendingArchive, setPendingArchive] = useState<OpenTerminal | null>(null);
  const [archiving, setArchiving] = useState(false);

  // Persisted display order (task ids). Reconciled against live sessions:
  // new sessions append at the end, closed sessions are pruned.
  const [order, setOrder] = useState<string[]>(loadGridOrder);
  // Live drag preview order (task ids) while a card is being dragged.
  const [dragOrder, setDragOrder] = useState<string[] | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const dragOrderRef = useRef<string[] | null>(null);
  const cleanupDragRef = useRef<(() => void) | null>(null);

  // Per-track sizes (fr units) for the current grid shape and the measured
  // pixel box we resize within. `resizing` drives the global cursor while a
  // divider is being dragged. Divider handles are invisible — only the
  // col/row-resize cursor reveals them.
  const [colSizes, setColSizes] = useState<number[]>(() => [1]);
  const [rowSizes, setRowSizes] = useState<number[]>(() => [1]);
  const [gridSize, setGridSize] = useState<{ width: number; height: number }>({
    width: 0,
    height: 0,
  });
  const [resizing, setResizing] = useState<"col" | "row" | null>(null);
  // Lazy useState (not useRef) so the localStorage read + JSON.parse happen
  // once — a useRef(loadGridResize()) argument would re-read on every render,
  // and this component re-renders per pointermove during a divider or card
  // drag. The map's identity is stable; commits mutate it in place like a ref.
  const [resizeMap] = useState<GridResizeMap>(loadGridResize);
  const resizeCleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    setOrder((prev) => {
      const ids = sessions.map((s) => s.taskId);
      const idSet = new Set(ids);
      const kept = prev.filter((id) => idSet.has(id));
      const keptSet = new Set(kept);
      const added = ids.filter((id) => !keptSet.has(id));
      const next = [...kept, ...added];
      const unchanged = next.length === prev.length && next.every((id, i) => id === prev[i]);
      if (unchanged) return prev;
      saveGridOrder(next);
      return next;
    });
    // A session removed out from under a stale expandedTaskId (e.g. an opened
    // archived session reaped on its grace timer) must not leave the grid with
    // reorder/resize disabled while no cell is visibly expanded.
    setExpandedTaskId((prev) =>
      prev && !sessions.some((s) => s.taskId === prev) ? null : prev,
    );
  }, [sessions]);

  useEffect(() => () => cleanupDragRef.current?.(), []);
  useEffect(() => () => resizeCleanupRef.current?.(), []);

  // Spotlight a cell when a notification's "Open" targets a grid session: make
  // it visible (collapse an unrelated expanded cell), scroll it into view, focus
  // its terminal, and ring it briefly so the user can pick it out.
  useEffect(() => {
    if (!gridFocusRequest) return;
    const { taskId } = gridFocusRequest;
    // A spotlight targets one session — end any keyboard-nav selection so its
    // dimming/ring doesn't fight the spotlight and Enter can't open a stale pick.
    setNavTaskId(null);
    setExpandedTaskId((prev) => (prev && prev !== taskId ? null : prev));
    setFocusedTaskId(taskId);
    const raf = requestAnimationFrame(() => {
      const selector = `[data-grid-cell][data-task-id="${CSS.escape(taskId)}"]`;
      const cell = gridRef.current?.querySelector<HTMLElement>(selector);
      if (!cell) return;
      cell.scrollIntoView({ block: "nearest", behavior: "smooth" });
      cell
        .querySelector<HTMLTextAreaElement>(".xterm-helper-textarea")
        ?.focus({ preventScroll: true });
    });
    const timer = window.setTimeout(
      () => setFocusedTaskId((prev) => (prev === taskId ? null : prev)),
      2200,
    );
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(timer);
    };
  }, [gridFocusRequest]);

  // Track the grid's pixel box so divider handles can be placed precisely.
  useEffect(() => {
    const el = gridRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const update = () => setGridSize({ width: el.clientWidth, height: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // While a divider is dragged, force the resize cursor everywhere and suppress
  // text selection (the pointer travels over xterm surfaces).
  useEffect(() => {
    if (!resizing) return;
    const prevCursor = document.body.style.cursor;
    const prevSelect = document.body.style.userSelect;
    document.body.style.cursor = resizing === "col" ? "col-resize" : "row-resize";
    document.body.style.userSelect = "none";
    return () => {
      document.body.style.cursor = prevCursor;
      document.body.style.userSelect = prevSelect;
    };
  }, [resizing]);

  // Whether closing this session needs the running-session warning. Prefer the
  // owning project's live cache; when it hasn't populated yet (right after a
  // reload into grid view) the persisted snapshot can be stale, so err toward
  // confirming rather than silently killing a possibly-running agent.
  const shouldConfirmClose = useCallback(
    (session: OpenTerminal): boolean => {
      const tasks = queryClient.getQueryData<Task[]>(
        queryKeys.tasks(
          session.project.id,
          session.project.activeWorktreeId ?? null,
          session.project.activeRuntimeScopeId ?? LOCAL_SCOPE_ID,
        ),
      );
      if (!tasks) return true;
      const live = tasks.find((t) => t.id === session.taskId);
      return (live ?? session.task).status === "running";
    },
    [queryClient],
  );

  // Close + archive one session (works across projects).
  const archiveSession = useCallback(
    async (session: OpenTerminal) => {
      try {
        await archiveOpenSession(session, close, queryClient);
      } catch (e: unknown) {
        toast.error(e instanceof Error ? e.message : "Could not archive session");
      }
    },
    [close, queryClient],
  );

  // Cell close (X): archive immediately when known idle; warn first when
  // running (or unknown), since archiving disconnects the terminal and stops
  // the agent.
  const requestClose = useCallback(
    (session: OpenTerminal) => {
      if (expandedTaskId === session.taskId) setExpandedTaskId(null);
      if (shouldConfirmClose(session)) {
        setPendingArchive(session);
        return;
      }
      void archiveSession(session);
    },
    [archiveSession, shouldConfirmClose, expandedTaskId],
  );

  const confirmArchive = useCallback(async () => {
    if (!pendingArchive) return;
    setArchiving(true);
    try {
      await archiveSession(pendingArchive);
    } finally {
      setArchiving(false);
      setPendingArchive(null);
    }
  }, [archiveSession, pendingArchive]);

  // Cmd/Ctrl+W while the grid owns the workspace: TerminalPanel (the usual
  // close-intent handler) is unmounted, so the grid archives the session whose
  // terminal owns focus instead — falling back to the expanded cell. Routed
  // through requestClose so the running-session confirm still applies. A
  // focused user terminal claims the shortcut first (mirrors TerminalPanel).
  const handleCloseIntent = useCallback(() => {
    if (userTerminals.panelOpen && isUserTerminalXtermFocused()) return;
    const focusedCell = document.activeElement?.closest("[data-grid-cell]");
    const taskId = focusedCell?.getAttribute("data-task-id") ?? expandedTaskId;
    if (!taskId) return;
    const session = sessions.find((s) => s.taskId === taskId);
    if (session) requestClose(session);
  }, [userTerminals.panelOpen, expandedTaskId, sessions, requestClose]);

  useEffect(() => {
    const electron = getElectron();
    if (!electron || sessions.length === 0) return;
    return electron.onCloseIntent(handleCloseIntent);
  }, [sessions.length, handleCloseIntent]);

  useHotkey("session.closeWindow", handleCloseIntent, {
    enabled: !isElectron() && sessions.length > 0,
    capture: true,
  });

  // Sessions in display order (drag preview takes precedence over saved order).
  const orderedSessions = useMemo(() => {
    const byId = new Map(sessions.map((s) => [s.taskId, s]));
    const ids = dragOrder ?? order;
    const listed = ids
      .map((id) => byId.get(id))
      .filter((s): s is OpenTerminal => !!s);
    // Any session not yet in the order array (first render before reconcile).
    const listedSet = new Set(listed.map((s) => s.taskId));
    const extras = sessions.filter((s) => !listedSet.has(s.taskId));
    return [...listed, ...extras];
  }, [sessions, order, dragOrder]);

  // Every open session stays mounted at all times, keeping the grid shape and
  // track sizes constant. Expanding a cell overlays it across the whole grid via
  // CSS (see the render) instead of unmounting the others — so collapsing
  // restores them instantly, with no reflow, no remount, and no FLIP churn.
  const visibleSessions = orderedSessions;

  // Progressive first mount: how many panes WITHOUT a cached surface may mount
  // right now. Starts at 0 so the first grid paint is just the empty frames,
  // then grows every frame until nothing is deferred. Cells whose surface is
  // already cached bypass the budget (their mount is a cheap DOM re-parent).
  const [paneMountBudget, setPaneMountBudget] = useState(0);
  let uncachedSeen = 0;
  let deferredPaneCount = 0;
  const cellMounted = visibleSessions.map((session) => {
    const cached = terminalSurfaceCache.has(
      terminalSurfaceIdForProject(session.project, session.taskId),
    );
    const mounted = cached || uncachedSeen++ < paneMountBudget;
    if (!mounted) deferredPaneCount += 1;
    return mounted;
  });
  useEffect(() => {
    if (deferredPaneCount === 0) return;
    const raf = requestAnimationFrame(() =>
      setPaneMountBudget((b) => b + PANE_MOUNTS_PER_FRAME),
    );
    return () => cancelAnimationFrame(raf);
  }, [deferredPaneCount, paneMountBudget]);

  // The held card follows the pointer via an inline transform (imperative, so
  // pointermove doesn't re-render). x/y are the latest pointer coords; grabX/Y
  // is where inside the card the user grabbed it, so it stays under the hand.
  const dragVisualRef = useRef<{
    taskId: string;
    x: number;
    y: number;
    grabX: number;
    grabY: number;
  } | null>(null);

  const positionDraggedCell = useCallback(() => {
    const v = dragVisualRef.current;
    const grid = gridRef.current;
    if (!v || !grid) return;
    const cell = grid.querySelector<HTMLElement>(
      `[data-grid-cell][data-task-id="${CSS.escape(v.taskId)}"]`,
    );
    if (!cell) return;
    const gridRect = grid.getBoundingClientRect();
    const layoutLeft = gridRect.left + cell.offsetLeft;
    const layoutTop = gridRect.top + cell.offsetTop;
    const dx = v.x - v.grabX - layoutLeft;
    const dy = v.y - v.grabY - layoutTop;
    cell.style.transform = `translate(${dx}px, ${dy}px) scale(1.015)`;
  }, []);

  // FLIP animation: whenever cells change slots (drag-preview swaps, sessions
  // opening/closing, expand toggles) each card glides from its previous rect
  // to the new one instead of snapping. Runs on every commit — non-reorder
  // renders only refresh the measured baseline so divider/window resizes never
  // animate, and a card already mid-flight continues from where it visually is.
  const cellRectsRef = useRef<Map<string, DOMRect>>(new Map());
  const flipSigRef = useRef<string | null>(null);
  // The set of visible cells no longer changes on expand/collapse, so the expand
  // state joins the signature: toggling it flips the affected cell from its slot
  // rect to the full-grid rect (and back), i.e. the zoom in / zoom out.
  const orderSig = visibleSessions.map((s) => s.taskId).join("|");
  const flipSig = `${expandedTaskId ?? ""}::${orderSig}`;
  useLayoutEffect(() => {
    const animate = flipSigRef.current !== null && flipSigRef.current !== flipSig;
    flipSigRef.current = flipSig;
    const grid = gridRef.current;
    const cells = grid?.querySelectorAll<HTMLElement>("[data-grid-cell]");
    if (!grid || !cells) return;
    const heldId = dragVisualRef.current?.taskId ?? null;
    const gridRect = grid.getBoundingClientRect();
    const prevRects = cellRectsRef.current;
    const nextRects = new Map<string, DOMRect>();
    cells.forEach((cell) => {
      const id = cell.getAttribute("data-task-id");
      if (!id) return;
      if (id === heldId) {
        // The held card tracks the pointer, not its slot — store its true slot
        // rect (offsets ignore the inline transform) and skip FLIP for it.
        nextRects.set(
          id,
          new DOMRect(
            gridRect.left + cell.offsetLeft,
            gridRect.top + cell.offsetTop,
            cell.offsetWidth,
            cell.offsetHeight,
          ),
        );
        return;
      }
      // Only our own FLIP animations count — the cell also runs CSS
      // transitions (opacity, box-shadow) that must not be cancelled.
      const inFlight = cell.getAnimations().filter((a) => a.id === FLIP_ID);
      if (!animate) {
        // A mid-flight cell's stored rect already points at its landing slot;
        // for settled cells re-measure so resizes keep the baseline fresh.
        const stored = inFlight.length > 0 ? prevRects.get(id) : undefined;
        nextRects.set(id, stored ?? cell.getBoundingClientRect());
        return;
      }
      // Where the card is visually right now (mid-animation included), then
      // its true landing slot once any in-flight FLIP is cancelled.
      const visual = cell.getBoundingClientRect();
      inFlight.forEach((a) => a.cancel());
      const target = cell.getBoundingClientRect();
      const start = inFlight.length > 0 ? visual : prevRects.get(id) ?? target;
      nextRects.set(id, target);
      const dx = start.left - target.left;
      const dy = start.top - target.top;
      const sx = target.width > 0 ? start.width / target.width : 1;
      const sy = target.height > 0 ? start.height / target.height : 1;
      if (
        Math.abs(dx) < 0.5 &&
        Math.abs(dy) < 0.5 &&
        Math.abs(sx - 1) < 0.005 &&
        Math.abs(sy - 1) < 0.005
      ) {
        return;
      }
      const anim = cell.animate(
        [
          {
            transformOrigin: "0 0",
            transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`,
          },
          { transformOrigin: "0 0", transform: "none" },
        ],
        { duration: FLIP_DURATION_MS, easing: FLIP_EASING },
      );
      anim.id = FLIP_ID;
    });
    cellRectsRef.current = nextRects;
    // A slot swap moves the held card's layout box; recompute its inline
    // transform so it stays glued to the pointer.
    positionDraggedCell();
  });

  const columns = useMemo(() => {
    const n = visibleSessions.length;
    if (n <= 1) return 1;
    return Math.ceil(Math.sqrt(n));
  }, [visibleSessions.length]);

  const rows = useMemo(() => {
    const n = visibleSessions.length;
    if (n <= 1) return 1;
    return Math.ceil(n / columns);
  }, [visibleSessions.length, columns]);

  const reorderEnabled = !expandedTaskId && sessions.length > 1;

  // Cards in a partial last row span the leftover columns so the row fills the
  // full width (e.g. 2 cards in a 4-col grid each span 2 → 50% / 50%).
  const lastRowStart = (rows - 1) * columns;
  const lastRowSpans = lastRowColumnSpans(visibleSessions.length - lastRowStart, columns);

  // Column boundaries (cumulative track counts) that still exist inside the
  // partial last row. A column divider not on one of these edges would cut
  // through a spanned cell, so it must stop above the last row.
  const lastRowEdges = useMemo(() => {
    if (!lastRowSpans) return null;
    const edges = new Set<number>();
    let acc = 0;
    for (const span of lastRowSpans.slice(0, -1)) {
      acc += span;
      edges.add(acc);
    }
    return edges;
  }, [lastRowSpans]);

  // Load (or default to equal) track sizes whenever the grid shape changes.
  const gridSig = `${columns}x${rows}`;
  useEffect(() => {
    const stored = resizeMap[gridSig];
    setColSizes(makeSizes(stored?.cols, columns));
    setRowSizes(makeSizes(stored?.rows, rows));
  }, [resizeMap, gridSig, columns, rows]);

  // Pixel space the fr tracks share, once gaps + padding are removed.
  const availW = Math.max(
    0,
    gridSize.width - GRID_PADDING * 2 - Math.max(0, columns - 1) * GRID_GAP,
  );
  const availH = Math.max(
    0,
    gridSize.height - GRID_PADDING * 2 - Math.max(0, rows - 1) * GRID_GAP,
  );
  const sizesReady = colSizes.length === columns && rowSizes.length === rows;
  const resizeEnabled = !expandedTaskId && visibleSessions.length > 1 && gridSize.width > 0;

  // Left/top pixel offset of the divider after track `index` (0-based).
  const dividerOffset = useCallback(
    (sizes: number[], avail: number, index: number): number => {
      const total = sizes.reduce((a, b) => a + b, 0) || 1;
      let before = 0;
      for (let k = 0; k <= index; k++) before += sizes[k] ?? 0;
      return GRID_PADDING + (before / total) * avail + index * GRID_GAP + GRID_GAP / 2;
    },
    [],
  );

  // Drag a divider: shift `fr` weight between the two adjacent tracks, keeping
  // their sum (and therefore every other track) fixed. Persisted on release.
  const startResize = useCallback(
    (axis: "col" | "row", index: number, event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      event.preventDefault();
      resizeCleanupRef.current?.();
      const pointerId = event.pointerId;
      const handleEl = event.currentTarget;
      const isCol = axis === "col";
      const startSizes = (isCol ? colSizes : rowSizes).slice();
      const avail = isCol ? availW : availH;
      if (avail <= 0 || index < 0 || index + 1 >= startSizes.length) return;
      try {
        handleEl.setPointerCapture(pointerId);
      } catch {
        /* element may be gone */
      }
      const total = startSizes.reduce((a, b) => a + b, 0) || 1;
      const startPos = isCol ? event.clientX : event.clientY;
      const a0 = startSizes[index]!;
      const b0 = startSizes[index + 1]!;
      const pairTotal = a0 + b0;
      const minFr = Math.min(pairTotal / 2, (MIN_CELL_PX / avail) * total);

      let latest = startSizes;
      const apply = (pos: number) => {
        const deltaFr = ((pos - startPos) / avail) * total;
        const na = Math.max(minFr, Math.min(pairTotal - minFr, a0 + deltaFr));
        const next = startSizes.slice();
        next[index] = na;
        next[index + 1] = pairTotal - na;
        latest = next;
        if (isCol) setColSizes(next);
        else setRowSizes(next);
      };

      const cleanup = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onCancel);
        if (handleEl.hasPointerCapture(pointerId)) handleEl.releasePointerCapture(pointerId);
        if (resizeCleanupRef.current === cleanup) resizeCleanupRef.current = null;
      };
      const commit = () => {
        cleanup();
        resizeMap[gridSig] = {
          cols: isCol ? latest : colSizes.slice(),
          rows: isCol ? rowSizes.slice() : latest,
        };
        saveGridResize(resizeMap);
        setResizing(null);
      };
      const onMove = (e: PointerEvent) => {
        if (e.pointerId !== pointerId) return;
        e.preventDefault();
        apply(isCol ? e.clientX : e.clientY);
      };
      const onUp = (e: PointerEvent) => {
        if (e.pointerId !== pointerId) return;
        apply(isCol ? e.clientX : e.clientY);
        commit();
      };
      const onCancel = (e: PointerEvent) => {
        if (e.pointerId !== pointerId) return;
        cleanup();
        setResizing(null);
      };

      window.addEventListener("pointermove", onMove, { passive: false });
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onCancel);
      resizeCleanupRef.current = cleanup;
      setResizing(axis);
    },
    [colSizes, rowSizes, availW, availH, gridSig, resizeMap],
  );

  // Index of the cell under the pointer (falls back to the nearest cell
  // centre). Uses layout positions (offsetLeft/Top) rather than bounding
  // rects — a cell mid-FLIP reports a transformed rect, which would bounce the
  // drop index back and forth while cards glide into place.
  const resolveDropIndex = useCallback((clientX: number, clientY: number): number => {
    const grid = gridRef.current;
    const cells = grid?.querySelectorAll<HTMLElement>("[data-grid-cell]");
    if (!grid || !cells || cells.length === 0) return -1;
    const gridRect = grid.getBoundingClientRect();
    const x = clientX - gridRect.left;
    const y = clientY - gridRect.top;
    let nearest = 0;
    let nearestDist = Infinity;
    for (let i = 0; i < cells.length; i++) {
      const cell = cells[i]!;
      const left = cell.offsetLeft;
      const top = cell.offsetTop;
      const width = cell.offsetWidth;
      const height = cell.offsetHeight;
      if (x >= left && x <= left + width && y >= top && y <= top + height) {
        return i;
      }
      const cx = left + width / 2;
      const cy = top + height / 2;
      const d = Math.hypot(x - cx, y - cy);
      if (d < nearestDist) {
        nearestDist = d;
        nearest = i;
      }
    }
    return nearest;
  }, []);

  // Move keyboard focus into a session's terminal so the user can type right
  // away — after the reordered cells have settled into their new DOM positions.
  const focusSessionTerminal = useCallback((taskId: string) => {
    requestAnimationFrame(() => {
      const selector = `[data-grid-cell][data-task-id="${CSS.escape(taskId)}"]`;
      gridRef.current
        ?.querySelector<HTMLElement>(selector)
        ?.querySelector<HTMLTextAreaElement>(".xterm-helper-textarea")
        ?.focus({ preventScroll: true });
    });
  }, []);

  // Stable callback handed to the memoized GridCell so its memo holds across
  // per-grid renders — a session just toggles its own expand state.
  const toggleExpanded = useCallback(
    (taskId: string) => {
      setExpandedTaskId((prev) => (prev === taskId ? null : taskId));
      // Clicking the expand/shrink button moved focus onto the button; hand it
      // straight back to the session's terminal (after the toggled layout
      // settles) so the user can keep typing without clicking back in.
      focusSessionTerminal(taskId);
    },
    [focusSessionTerminal],
  );

  // Cmd/Ctrl+K (terminal.expandToggle) while the grid owns the workspace:
  // TerminalPanel's single-session expand is unmounted, so __root dispatches to
  // the grid instead. Toggle the cell whose terminal owns focus, falling back to
  // the currently expanded cell (its terminal is focused, so this collapses it).
  useEffect(() => {
    const onToggle = () => {
      const focusedCell = document.activeElement?.closest("[data-grid-cell]");
      const taskId = focusedCell?.getAttribute("data-task-id") ?? expandedTaskId;
      if (taskId && sessions.some((s) => s.taskId === taskId)) toggleExpanded(taskId);
    };
    window.addEventListener(GRID_EXPAND_TOGGLE_EVENT, onToggle);
    return () => window.removeEventListener(GRID_EXPAND_TOGGLE_EVENT, onToggle);
  }, [expandedTaskId, sessions, toggleExpanded]);

  // ── Keyboard grid navigation (Cmd/Ctrl+Shift+G) ────────────────────────────
  // Enter a selection mode where arrow keys move a highlight between cells and
  // Enter activates the chosen session (focuses its terminal, like a click).
  // Triggered by the dedicated, rebindable session.gridNavigate shortcut and
  // scoped to the grid. Keys are handled in the capture phase so the focused
  // xterm surface can't swallow the arrows/Enter first.
  const navActive = navTaskId !== null;

  // Human-readable position of the current selection, announced to assistive
  // tech via the live region in the render (updates on every move).
  const navLabel = useMemo(() => {
    if (navTaskId === null) return "";
    const idx = orderedSessions.findIndex((s) => s.taskId === navTaskId);
    return idx < 0 ? "" : `Session ${idx + 1} of ${orderedSessions.length} selected`;
  }, [navTaskId, orderedSessions]);

  const enterGridNav = useCallback(() => {
    const ids = orderedSessions.map((s) => s.taskId);
    // Start on the cell that currently owns focus, else the first session. Focus
    // is left where it is — the capture listener intercepts nav keys, and keeping
    // the terminal focused keeps Cmd/Ctrl+W and cancel behaving normally.
    const originId = document.activeElement
      ?.closest("[data-grid-cell]")
      ?.getAttribute("data-task-id");
    const startId = originId && ids.includes(originId) ? originId : ids[0] ?? null;
    if (startId) setNavTaskId(startId);
  }, [orderedSessions]);

  // Move the selection by on-screen geometry rather than index math: a partial
  // last row spans its cells to fill the width, so `row*columns + col` no longer
  // maps to a cell (e.g. the cell below the top-right one is the last index, not
  // index+columns). Reading real cell centres also handles resized tracks. Pick
  // the nearest cell in the requested direction, strongly preferring ones lined
  // up on the perpendicular axis (same row for left/right, same column for
  // up/down); with none in that direction the selection holds.
  const moveGridNav = useCallback((dir: "left" | "right" | "up" | "down") => {
    setNavTaskId((current) => {
      if (current === null) return current;
      const cells = gridRef.current?.querySelectorAll<HTMLElement>("[data-grid-cell]");
      if (!cells || cells.length === 0) return current;
      const boxes = Array.from(cells)
        .map((cell) => {
          const id = cell.getAttribute("data-task-id");
          return id
            ? {
                id,
                cx: cell.offsetLeft + cell.offsetWidth / 2,
                cy: cell.offsetTop + cell.offsetHeight / 2,
              }
            : null;
        })
        .filter((b): b is { id: string; cx: number; cy: number } => b !== null);
      const cur = boxes.find((b) => b.id === current);
      if (!cur) return current;
      const horizontal = dir === "left" || dir === "right";
      const sign = dir === "right" || dir === "down" ? 1 : -1;
      let best: string | null = null;
      let bestScore = Infinity;
      for (const b of boxes) {
        if (b.id === current) continue;
        const primary = horizontal ? b.cx - cur.cx : b.cy - cur.cy;
        if (primary * sign <= 1) continue; // not in the requested direction
        const perp = horizontal ? Math.abs(b.cy - cur.cy) : Math.abs(b.cx - cur.cx);
        const score = perp * 100_000 + Math.abs(primary);
        if (score < bestScore) {
          bestScore = score;
          best = b.id;
        }
      }
      return best ?? current;
    });
  }, []);

  const confirmGridNav = useCallback(() => {
    setNavTaskId((current) => {
      if (current) focusSessionTerminal(current);
      return null;
    });
  }, [focusSessionTerminal]);

  // Cancel leaves focus untouched (nav mode never moved it), so the terminal the
  // user was already in stays focused.
  const cancelGridNav = useCallback(() => setNavTaskId(null), []);

  // Leave nav mode if it goes stale: the selected session closed, the grid
  // collapsed to a single cell, or a cell was expanded to fill the grid.
  useEffect(() => {
    if (navTaskId === null) return;
    if (expandedTaskId || sessions.length < 2 || !sessions.some((s) => s.taskId === navTaskId)) {
      setNavTaskId(null);
    }
  }, [navTaskId, expandedTaskId, sessions]);

  // Any pointer interaction takes over from the keyboard — clicking a terminal
  // to type, grabbing a divider, hitting a toolbar button — so end nav mode.
  // Capture phase so it wins before the target's own pointer handlers run.
  useEffect(() => {
    if (!navActive) return;
    const onPointerDown = () => setNavTaskId(null);
    window.addEventListener("pointerdown", onPointerDown, true);
    return () => window.removeEventListener("pointerdown", onPointerDown, true);
  }, [navActive]);

  // The capture-phase key handler, refreshed every render (mirrors useHotkey's
  // handlerRef) so the window listener subscribes exactly once — no stale closure
  // right after entering nav, no per-state-change re-subscription churn.
  const onNavKeyRef = useRef<(e: KeyboardEvent) => void>(() => {});
  onNavKeyRef.current = (e: KeyboardEvent) => {
    // The trigger is the dedicated, rebindable session.gridNavigate shortcut.
    const trigger = matchBinding(e, bindings["session.gridNavigate"]);
    if (navTaskId !== null) {
      switch (e.key) {
        case "ArrowRight":
          e.preventDefault();
          e.stopPropagation();
          moveGridNav("right");
          return;
        case "ArrowLeft":
          e.preventDefault();
          e.stopPropagation();
          moveGridNav("left");
          return;
        case "ArrowDown":
          e.preventDefault();
          e.stopPropagation();
          moveGridNav("down");
          return;
        case "ArrowUp":
          e.preventDefault();
          e.stopPropagation();
          moveGridNav("up");
          return;
        case "Enter":
          if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) break;
          e.preventDefault();
          e.stopPropagation();
          confirmGridNav();
          return;
        case "Escape":
          e.preventDefault();
          e.stopPropagation();
          cancelGridNav();
          return;
      }
      // The trigger combo again toggles nav off.
      if (trigger) {
        e.preventDefault();
        e.stopPropagation();
        cancelGridNav();
        return;
      }
      // Any other key ends nav mode and is left to reach its real target (a
      // hotkey like Cmd+N opening a dialog, or a keystroke resuming the terminal).
      setNavTaskId(null);
      return;
    }
    if (!trigger) return;
    // Defer to the settings overlay, any open modal, and anything the user is
    // typing into (dialog field, search box, bottom user terminal). A focused
    // session terminal is the intended trigger point, so it is allowed through.
    if (
      isSettingsOverlayOpen() ||
      document.querySelector("[data-modal-open]") !== null ||
      isNonGridTerminalEditableFocused()
    ) {
      return;
    }
    // Claim the key whether or not nav can be entered right now, so nothing else
    // (e.g. a browser build's "find previous" on Cmd/Ctrl+Shift+G) acts on it.
    e.preventDefault();
    e.stopPropagation();
    if (expandedTaskId || sessions.length < 2) return;
    enterGridNav();
  };

  useEffect(() => {
    if (sessions.length === 0) return;
    const handler = (e: KeyboardEvent) => onNavKeyRef.current(e);
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [sessions.length]);

  const startPointerReorder = useCallback(
    (taskId: string, event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      cleanupDragRef.current?.();

      // A press that lands on a header button (rename, expand, close) must not
      // steal focus into the terminal — let those controls do their own thing.
      const startedOnControl = !!(event.target as HTMLElement | null)?.closest(
        "button, a, input, textarea",
      );

      const baseOrder = orderedSessions.map((s) => s.taskId);
      dragOrderRef.current = baseOrder;
      const drag: PointerDragState = {
        id: taskId,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        moved: false,
      };
      // The header bar is the drag handle. Pointer capture is deferred until the
      // move threshold is crossed so a plain click on a header button (rename,
      // expand, close) still fires its onClick instead of being hijacked.
      const handleEl = event.currentTarget;

      const applyMove = (clientX: number, clientY: number) => {
        const current = dragOrderRef.current ?? baseOrder;
        const fromIndex = current.indexOf(taskId);
        const toIndex = resolveDropIndex(clientX, clientY);
        if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return;
        const next = reorderPinnedIds(current, fromIndex, toIndex);
        dragOrderRef.current = next;
        setDragOrder(next);
      };

      const cellSelector = `[data-grid-cell][data-task-id="${CSS.escape(taskId)}"]`;

      const onPointerMove = (moveEvent: PointerEvent) => {
        if (moveEvent.pointerId !== drag.pointerId) return;
        if (!drag.moved) {
          const dist = Math.hypot(moveEvent.clientX - drag.startX, moveEvent.clientY - drag.startY);
          if (dist < DRAG_THRESHOLD_PX) return;
          drag.moved = true;
          setDraggingId(taskId);
          // Capture now so the drag keeps tracking even over xterm surfaces.
          try {
            handleEl.setPointerCapture(drag.pointerId);
          } catch {
            /* element may be gone */
          }
          // Lift the card: from now on it tracks the pointer instead of
          // sitting in its slot. Cancel any in-flight FLIP first — a WAAPI
          // transform would override the inline follow transform.
          const cell = gridRef.current?.querySelector<HTMLElement>(cellSelector);
          if (cell) {
            cell
              .getAnimations()
              .filter((a) => a.id === FLIP_ID)
              .forEach((a) => a.cancel());
            const rect = cell.getBoundingClientRect();
            dragVisualRef.current = {
              taskId,
              x: moveEvent.clientX,
              y: moveEvent.clientY,
              grabX: drag.startX - rect.left,
              grabY: drag.startY - rect.top,
            };
          }
        }
        moveEvent.preventDefault();
        const v = dragVisualRef.current;
        if (v) {
          v.x = moveEvent.clientX;
          v.y = moveEvent.clientY;
          positionDraggedCell();
        }
        applyMove(moveEvent.clientX, moveEvent.clientY);
      };

      const cleanup = () => {
        window.removeEventListener("pointermove", onPointerMove);
        window.removeEventListener("pointerup", onPointerUp);
        window.removeEventListener("pointercancel", onPointerCancel);
        if (handleEl.hasPointerCapture(drag.pointerId)) {
          handleEl.releasePointerCapture(drag.pointerId);
        }
        if (cleanupDragRef.current === cleanup) cleanupDragRef.current = null;
      };

      const finish = (commit: boolean) => {
        cleanup();
        // Release the card: drop the pointer-follow transform and glide it
        // from where it was held into its slot.
        dragVisualRef.current = null;
        const cell = gridRef.current?.querySelector<HTMLElement>(cellSelector);
        if (cell && drag.moved) {
          const held = cell.style.transform;
          cell.style.transform = "";
          if (held && held !== "none") {
            const anim = cell.animate([{ transform: held }, { transform: "none" }], {
              duration: FLIP_DURATION_MS,
              easing: FLIP_EASING,
            });
            anim.id = FLIP_ID;
          }
        }
        const finalOrder = dragOrderRef.current;
        if (commit && drag.moved && finalOrder) {
          setOrder(finalOrder);
          saveGridOrder(finalOrder);
        }
        dragOrderRef.current = null;
        setDragOrder(null);
        setDraggingId(null);
        // Set the session active by focusing its terminal, so the user can type
        // without a second click. This covers both a drag (whose pointer capture
        // pulled focus off the xterm surface) and a plain click on the header
        // bar — except clicks on a header button, which own their own behavior.
        if (drag.moved || !startedOnControl) {
          focusSessionTerminal(taskId);
        }
      };

      const onPointerUp = (upEvent: PointerEvent) => {
        if (upEvent.pointerId !== drag.pointerId) return;
        if (drag.moved) {
          upEvent.preventDefault();
          applyMove(upEvent.clientX, upEvent.clientY);
        }
        finish(true);
      };

      const onPointerCancel = (cancelEvent: PointerEvent) => {
        if (cancelEvent.pointerId !== drag.pointerId) return;
        finish(false);
      };

      window.addEventListener("pointermove", onPointerMove, { passive: false });
      window.addEventListener("pointerup", onPointerUp);
      window.addEventListener("pointercancel", onPointerCancel);
      cleanupDragRef.current = cleanup;
    },
    [orderedSessions, resolveDropIndex, positionDraggedCell, focusSessionTerminal],
  );

  if (sessions.length === 0) {
    return (
      <div
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--text-dim)",
          fontFamily: "var(--mono)",
          fontSize: 13,
          padding: 24,
          textAlign: "center",
        }}
      >
        No open sessions. Start a session to see it here.
      </div>
    );
  }

  return (
    <>
      <div
        ref={gridRef}
        data-session-grid
        style={{
          position: "relative",
          flex: 1,
          minHeight: 0,
          minWidth: 0,
          display: "grid",
          gridTemplateColumns: sizesReady
            ? colSizes.map((s) => `minmax(0, ${s}fr)`).join(" ")
            : `repeat(${columns}, minmax(0, 1fr))`,
          gridTemplateRows: sizesReady
            ? rowSizes.map((s) => `minmax(0, ${s}fr)`).join(" ")
            : `repeat(${rows}, minmax(0, 1fr))`,
          gridAutoRows: "minmax(0, 1fr)",
          gap: GRID_GAP,
          padding: GRID_PADDING,
          overflow: "hidden",
        }}
      >
        {visibleSessions.map((session, index) => {
          const scopeKey = scopeKeyFor(session);
          const isExpandedCell = expandedTaskId === session.taskId;
          const place = cellPlacement(index, columns, rows, lastRowStart, lastRowSpans);
          // The expanded cell spans the whole grid and floats above the rest;
          // every other cell stays pinned to its own slot.
          const gridColumn = isExpandedCell
            ? "1 / -1"
            : `${place.colStart} / span ${place.colSpan}`;
          const gridRow = isExpandedCell ? "1 / -1" : `${place.rowStart}`;
          const isDragging = draggingId === session.taskId;
          return (
            <GridCell
              key={`${session.taskId}:${scopeKey}`}
              session={session}
              scopeKey={scopeKey}
              mounted={cellMounted[index] ?? true}
              expanded={isExpandedCell}
              hidden={expandedTaskId !== null && !isExpandedCell}
              isDragging={isDragging}
              isFocused={!isDragging && focusedTaskId === session.taskId}
              isNavSelected={navTaskId === session.taskId}
              navActive={navActive}
              gridColumn={gridColumn}
              gridRow={gridRow}
              reorderEnabled={reorderEnabled}
              onToggleExpanded={toggleExpanded}
              onRequestClose={requestClose}
              onPtyReady={setPtyId}
              onHeaderPointerDown={startPointerReorder}
            />
          );
        })}
        {resizeEnabled && sizesReady && (
          <>
            {Array.from({ length: columns - 1 }).map((_, i) => {
              // Stop above the partial last row when the divider's column
              // boundary falls inside a spanned cell there.
              const crossesLastRow = !lastRowEdges || lastRowEdges.has(i + 1);
              const bottom = crossesLastRow
                ? GRID_PADDING
                : gridSize.height -
                  (dividerOffset(rowSizes, availH, rows - 2) - GRID_GAP / 2);
              return (
                <div
                  key={`col-${i}`}
                  onPointerDown={(e) => startResize("col", i, e)}
                  style={{
                    position: "absolute",
                    left: dividerOffset(colSizes, availW, i),
                    top: GRID_PADDING,
                    bottom,
                    width: HANDLE_HIT,
                    transform: "translateX(-50%)",
                    cursor: "col-resize",
                    zIndex: 6,
                    touchAction: "none",
                  }}
                />
              );
            })}
            {Array.from({ length: rows - 1 }).map((_, i) => (
              <div
                key={`row-${i}`}
                onPointerDown={(e) => startResize("row", i, e)}
                style={{
                  position: "absolute",
                  top: dividerOffset(rowSizes, availH, i),
                  left: GRID_PADDING,
                  right: GRID_PADDING,
                  height: HANDLE_HIT,
                  transform: "translateY(-50%)",
                  cursor: "row-resize",
                  zIndex: 6,
                  touchAction: "none",
                }}
              />
            ))}
          </>
        )}
        {navActive && (
          <>
            <div
              aria-hidden="true"
              style={{
                position: "absolute",
                bottom: 12,
                left: "50%",
                transform: "translateX(-50%)",
                zIndex: 10,
                pointerEvents: "none",
                display: "flex",
                gap: 12,
                alignItems: "center",
                maxWidth: "calc(100% - 24px)",
                padding: "6px 12px",
                background: "var(--surface-2)",
                color: "var(--text)",
                border: "1px solid var(--border)",
                borderRadius: 8,
                boxShadow: "0 8px 24px rgba(0, 0, 0, 0.4)",
                fontFamily: "var(--mono)",
                fontSize: 12,
                whiteSpace: "nowrap",
              }}
            >
              <span>Navigate sessions</span>
              <span style={{ opacity: 0.6 }}>↑ ↓ ← → move</span>
              <span style={{ opacity: 0.6 }}>Enter open</span>
              <span style={{ opacity: 0.6 }}>Esc cancel</span>
            </div>
            {/* Screen-reader only: announces the moving selection each keystroke
                (the visible bar above is decorative, so aria-hidden). */}
            <div
              role="status"
              aria-live="polite"
              style={{
                position: "absolute",
                width: 1,
                height: 1,
                margin: -1,
                padding: 0,
                border: 0,
                overflow: "hidden",
                clip: "rect(0 0 0 0)",
                clipPath: "inset(50%)",
                whiteSpace: "nowrap",
              }}
            >
              {navLabel}
            </div>
          </>
        )}
      </div>
      <ConfirmDialog
        open={!!pendingArchive}
        onClose={() => setPendingArchive(null)}
        onConfirm={confirmArchive}
        title="Archive running session?"
        confirmLabel="Archive"
        variant="danger"
        icon="archive"
        loading={archiving}
      >
        This session is still running. Archiving disconnects its terminal and
        stops the in-progress agent. You can restore it later, but the current
        run won&rsquo;t resume.
      </ConfirmDialog>
    </>
  );
}
