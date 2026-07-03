import {
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
import { getElectron, isElectron } from "~/lib/electron";
import { reorderPinnedIds } from "~/lib/pinned-project-order";
import { isUserTerminalXtermFocused } from "~/lib/terminal-pane-helpers";
import { useTerminals, type OpenTerminal } from "~/lib/terminal-store";
import { useHotkey } from "~/lib/use-hotkey";
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
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);
  // Task whose cell is momentarily spotlighted after a notification "Open".
  const [focusedTaskId, setFocusedTaskId] = useState<string | null>(null);
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

  const visibleSessions = useMemo(() => {
    if (!expandedTaskId) return orderedSessions;
    const found = orderedSessions.find((s) => s.taskId === expandedTaskId);
    return found ? [found] : orderedSessions;
  }, [orderedSessions, expandedTaskId]);

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
  const orderSig = visibleSessions.map((s) => s.taskId).join("|");
  useLayoutEffect(() => {
    const animate = flipSigRef.current !== null && flipSigRef.current !== orderSig;
    flipSigRef.current = orderSig;
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
          const expanded = expandedTaskId === session.taskId;
          const isDragging = draggingId === session.taskId;
          const isFocused = !isDragging && focusedTaskId === session.taskId;
          const spanIndex = index - lastRowStart;
          const colSpan =
            lastRowSpans && spanIndex >= 0 ? lastRowSpans[spanIndex] : undefined;
          return (
            <CardFrame
              key={`${session.taskId}:${scopeKey}`}
              data-grid-cell
              data-task-id={session.taskId}
              style={{
                display: "flex",
                flexDirection: "column",
                minWidth: 0,
                minHeight: 0,
                gridColumn: colSpan ? `span ${colSpan}` : undefined,
                overflow: "hidden",
                opacity: isDragging ? 0.9 : 1,
                outline:
                  isDragging || isFocused ? "2px solid var(--accent)" : undefined,
                outlineOffset: isDragging || isFocused ? -2 : undefined,
                // While held, float above siblings with a lift shadow so the
                // card visibly travels with the pointer.
                zIndex: isDragging ? 5 : undefined,
                boxShadow: isDragging
                  ? "0 16px 40px rgba(0, 0, 0, 0.5)"
                  : isFocused
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
                <TerminalPane
                  project={session.project}
                  task={session.task}
                  descriptor={session}
                  isLast
                  expanded={expanded}
                  onToggleExpanded={() =>
                    setExpandedTaskId((prev) => (prev === session.taskId ? null : session.taskId))
                  }
                  onHide={() => requestClose(session)}
                  onPtyReady={(ptyId) => setPtyId(session.taskId, ptyId, scopeKey)}
                  onHeaderPointerDown={
                    reorderEnabled
                      ? (e) => startPointerReorder(session.taskId, e)
                      : undefined
                  }
                  headerGrabbing={isDragging}
                />
              </div>
            </CardFrame>
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
