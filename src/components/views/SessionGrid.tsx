import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Btn } from "~/components/ui/Btn";
import { CardFrame } from "~/components/ui/CardFrame";
import { ConfirmDialog } from "~/components/ui/ConfirmDialog";
import { EmptyState } from "~/components/ui/EmptyState";
import { SessionIcon } from "~/components/ui/SessionIcon";
import { StatusDot } from "~/components/ui/StatusDot";
import { Tooltip } from "~/components/ui/Tooltip";
import { archiveOpenSession } from "~/lib/archive-session";
import { AGENT_META, GRID_EXPAND_TOGGLE_EVENT, STATUS_META } from "~/lib/design-meta";
import { getElectron, isElectron } from "~/lib/electron";
import { matchBinding } from "~/lib/keybindings/match";
import { useKeybindings } from "~/lib/keybindings/store";
import { DEFAULT_SESSION_ICON, isSessionIcon } from "~/lib/session-icons";
import { isSettingsOverlayOpen } from "~/lib/settings-navigation";
import { isUserTerminalXtermFocused } from "~/lib/terminal-pane-helpers";
import { useTerminals, type OpenTerminal } from "~/lib/terminal-store";
import { isEditableTarget, useHotkey } from "~/lib/use-hotkey";
import { useUserTerminals } from "~/lib/user-terminal-store";
import { readCachedThemeStyle } from "~/lib/theme-style";
import { queryKeys, useSettings, useTasks } from "~/queries";
import { LOCAL_SCOPE_ID } from "~/shared/sandbox";
import { worktreeScopeKey } from "~/shared/worktrees";
import { TerminalPane } from "./TerminalPane";
import type { Task } from "~/db/schema";

// Grid layout is stored per scope (project + worktree + runtime scope) so each
// project keeps its own rows, order, and sizing — the grid mirrors the single
// panel view's scoping instead of pooling every project's sessions together.
const GRID_LAYOUT_PREFIX = "mc.gridLayout";
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

/** One row of the grid: an ordered list of session ids plus a matching array of
 *  `fr` weights, so every row sizes its own columns independently. */
type GridRow = { cells: string[]; colSizes: number[] };
/** The authored grid: rows top-to-bottom, each with its own column widths, plus
 *  the per-row height weights. Persisted per scope. */
type GridLayout = { rows: GridRow[]; rowSizes: number[] };

const EMPTY_LAYOUT: GridLayout = { rows: [], rowSizes: [] };

function layoutStorageKey(scopeKey: string): string {
  return `${GRID_LAYOUT_PREFIX}:${scopeKey}`;
}

/** Positive finite track weights, or null when the stored entry is malformed. */
function sanitizeTracks(value: unknown): number[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  return value.every((n) => typeof n === "number" && Number.isFinite(n) && n > 0)
    ? (value as number[])
    : null;
}

/** Load a scope's saved layout, or null when absent/malformed (the caller then
 *  seeds a fresh layout from the scope's live sessions). Each entry is validated
 *  so a corrupt/legacy blob degrades to equal weights instead of crashing. */
function loadGridLayout(scopeKey: string): GridLayout | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(layoutStorageKey(scopeKey));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const rawRows = (parsed as { rows?: unknown }).rows;
    if (!Array.isArray(rawRows)) return null;
    const rows: GridRow[] = [];
    for (const entry of rawRows) {
      if (!entry || typeof entry !== "object") continue;
      const cellsRaw = (entry as { cells?: unknown }).cells;
      if (!Array.isArray(cellsRaw)) continue;
      const cells = cellsRaw.filter((c): c is string => typeof c === "string");
      if (cells.length === 0) continue;
      const stored = sanitizeTracks((entry as { colSizes?: unknown }).colSizes);
      const colSizes = stored && stored.length === cells.length ? stored : cells.map(() => 1);
      rows.push({ cells, colSizes });
    }
    if (rows.length === 0) return null;
    const storedRowSizes = sanitizeTracks((parsed as { rowSizes?: unknown }).rowSizes);
    const rowSizes =
      storedRowSizes && storedRowSizes.length === rows.length ? storedRowSizes : rows.map(() => 1);
    return { rows, rowSizes };
  } catch {
    return null;
  }
}

function saveGridLayout(scopeKey: string, layout: GridLayout): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(layoutStorageKey(scopeKey), JSON.stringify(layout));
  } catch {
    /* quota or disabled */
  }
}

// Hidden sessions are stored per scope alongside the layout, so a hide
// survives leaving grid view and app restarts. Stale ids (archived/closed
// sessions) are pruned against the live session list after load.
const GRID_HIDDEN_PREFIX = "mc.gridHidden";

function hiddenStorageKey(scopeKey: string): string {
  return `${GRID_HIDDEN_PREFIX}:${scopeKey}`;
}

function loadHiddenTaskIds(scopeKey: string): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(hiddenStorageKey(scopeKey));
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((id): id is string => typeof id === "string"));
  } catch {
    return new Set();
  }
}

function saveHiddenTaskIds(scopeKey: string, ids: ReadonlySet<string>): void {
  if (typeof window === "undefined") return;
  try {
    if (ids.size === 0) {
      window.localStorage.removeItem(hiddenStorageKey(scopeKey));
    } else {
      window.localStorage.setItem(hiddenStorageKey(scopeKey), JSON.stringify(Array.from(ids)));
    }
  } catch {
    /* quota or disabled */
  }
}

function cloneLayout(layout: GridLayout): GridLayout {
  return {
    rows: layout.rows.map((r) => ({ cells: r.cells.slice(), colSizes: r.colSizes.slice() })),
    rowSizes: layout.rowSizes.slice(),
  };
}

/** Mean of a weight array — the width a newly-added cell takes so its row-mates
 *  keep their relative sizes. */
function meanWeight(sizes: number[]): number {
  if (sizes.length === 0) return 1;
  const total = sizes.reduce((a, b) => a + b, 0);
  return total > 0 ? total / sizes.length : 1;
}

/** Build a `grid-template` track list (`minmax(0, Nfr)…`) from relative weights,
 *  normalized so the weights always sum to at least the track count. CSS grid
 *  floors the flex-factor sum at 1, so a track list summing below 1 — e.g. a lone
 *  survivor cell left with a 0.9fr weight after its row-mate is removed — only
 *  fills that fraction of the container, leaving a gap. Scaling every weight by
 *  count/total keeps each track's relative size but guarantees they fill. */
export function frTracks(weights: number[]): string {
  if (weights.length === 0) return "";
  const total = weights.reduce((a, b) => a + b, 0);
  const scale = total > 0 ? weights.length / total : 1;
  return weights.map((w) => `minmax(0, ${w * scale}fr)`).join(" ");
}

/** A fresh scope with no saved layout seeds this near-square shape (mirrors the
 *  old auto-grid: `ceil(√n)` columns per row) so the first paint doesn't jump. */
function chunkIntoRows(ids: string[]): GridLayout {
  if (ids.length === 0) return EMPTY_LAYOUT;
  const columns = ids.length <= 1 ? 1 : Math.ceil(Math.sqrt(ids.length));
  const rows: GridRow[] = [];
  for (let i = 0; i < ids.length; i += columns) {
    const cells = ids.slice(i, i + columns);
    rows.push({ cells, colSizes: cells.map(() => 1) });
  }
  return { rows, rowSizes: rows.map(() => 1) };
}

/** Row/column of a cell within the layout, or null if absent. */
function findCell(rows: GridRow[], id: string): { row: number; col: number } | null {
  for (let r = 0; r < rows.length; r++) {
    const c = rows[r]!.cells.indexOf(id);
    if (c >= 0) return { row: r, col: c };
  }
  return null;
}

/** Cell-order signature (ignores sizes) — cheap equality for reconcile/drag. */
function layoutSig(layout: GridLayout): string {
  return layout.rows.map((r) => r.cells.join(",")).join("|");
}

/** Drop any empty rows (and their height tracks), keeping the two arrays aligned. */
function dropEmptyRows(layout: GridLayout): GridLayout {
  const rows: GridRow[] = [];
  const rowSizes: number[] = [];
  layout.rows.forEach((r, i) => {
    if (r.cells.length > 0) {
      rows.push(r);
      rowSizes.push(layout.rowSizes[i] ?? 1);
    }
  });
  return { rows, rowSizes };
}

/** Reconcile a base layout against the live scoped sessions: follow id renames,
 *  prune closed cells (and empty rows), then place genuinely-new sessions —
 *  beside their clone source, in a fresh row, or appended to the current row. */
function reconcileLayout(
  base: GridLayout,
  liveIds: string[],
  renames: Array<{ from: string; to: string }>,
  placement: { cloneAfter: string | null; newRow: boolean; anchor: string | null },
): GridLayout {
  const idSet = new Set(liveIds);
  const layout = cloneLayout(base);
  // 1. Follow provisional→persisted id swaps in place.
  if (renames.length) {
    const renameMap = new Map(renames.map((r) => [r.from, r.to]));
    for (const row of layout.rows) {
      row.cells = row.cells.map((id) => renameMap.get(id) ?? id);
    }
  }
  // 2. Prune cells no longer live, keeping each survivor's width track.
  for (const row of layout.rows) {
    const cells: string[] = [];
    const colSizes: number[] = [];
    row.cells.forEach((id, i) => {
      if (idSet.has(id)) {
        cells.push(id);
        colSizes.push(row.colSizes[i] ?? 1);
      }
    });
    row.cells = cells;
    row.colSizes = colSizes;
  }
  let next = dropEmptyRows(layout);
  // 3. Place sessions not yet anywhere in the layout.
  const placed = new Set(next.rows.flatMap((r) => r.cells));
  const added = liveIds.filter((id) => !placed.has(id));
  if (added.length === 0) return next;

  const cloneAt = placement.cloneAfter ? findCell(next.rows, placement.cloneAfter) : null;
  if (cloneAt) {
    const row = next.rows[cloneAt.row]!;
    const weight = meanWeight(row.colSizes);
    row.cells.splice(cloneAt.col + 1, 0, ...added);
    row.colSizes.splice(cloneAt.col + 1, 0, ...added.map(() => weight));
    return next;
  }
  if (placement.newRow || next.rows.length === 0) {
    next.rows.push({ cells: added.slice(), colSizes: added.map(() => 1) });
    next.rowSizes.push(1);
    return next;
  }
  const anchorAt = placement.anchor ? findCell(next.rows, placement.anchor) : null;
  const targetRow = anchorAt ? anchorAt.row : next.rows.length - 1;
  const row = next.rows[targetRow]!;
  const weight = meanWeight(row.colSizes);
  row.cells.push(...added);
  row.colSizes.push(...added.map(() => weight));
  return next;
}

/** Move a cell to (dstRow, dstCol), carrying its width; removes a now-empty
 *  source row. Returns null if the move is impossible. */
function moveCellInLayout(
  layout: GridLayout,
  srcRow: number,
  srcCol: number,
  dstRow: number,
  dstCol: number,
): GridLayout | null {
  const rows = layout.rows.map((r) => ({ cells: r.cells.slice(), colSizes: r.colSizes.slice() }));
  const rowSizes = layout.rowSizes.slice();
  const source = rows[srcRow];
  if (!source) return null;
  const id = source.cells[srcCol];
  if (id === undefined) return null;
  const weight = source.colSizes[srcCol] ?? 1;
  source.cells.splice(srcCol, 1);
  source.colSizes.splice(srcCol, 1);
  const insertRow = dstRow;
  let insertCol = dstCol;
  // The removal shifted later cells in the same row down by one.
  if (dstRow === srcRow && dstCol > srcCol) insertCol -= 1;
  const dest = rows[insertRow];
  if (!dest) return null;
  insertCol = Math.max(0, Math.min(insertCol, dest.cells.length));
  dest.cells.splice(insertCol, 0, id);
  dest.colSizes.splice(insertCol, 0, weight);
  return dropEmptyRows({ rows, rowSizes });
}

/** Surface/scope key for a session — mirrors TerminalPanel so the grid reuses
 *  the same cached xterm surface (and live PTY) as the single-panel view, and
 *  matches the route's `selectedScopeKey` exactly so we can filter by it. */
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
  reorderEnabled: boolean;
  /** Grid outer padding (0 in the flush ember layout) — the expanded cell
   *  insets by this to cover the grid content box exactly. */
  gridPadding: number;
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
  reorderEnabled,
  gridPadding,
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
        // The expanded cell floats above its (hidden) row-mates and every other
        // row, covering the whole grid content box. Because the row containers
        // are non-positioned, `inset` resolves against the positioned grid.
        ...(expanded ? { position: "absolute" as const, inset: gridPadding } : null),
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
        // sits above its dimmed neighbours so its ring/glow isn't clipped. A
        // focused cell lifts one step so its accent border + drop shadow read
        // over flush neighbours (the ember layout has no gap between cells).
        zIndex: expanded ? 8 : isDragging ? 5 : isNavSelected ? 4 : isFocused ? 3 : undefined,
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
 * Slim bar pinned under the grid listing the sessions hidden with Cmd/Ctrl+L,
 * so a hidden session stays one click away instead of vanishing entirely.
 * Each chip shows the session's icon + title + live status dot; hovering a
 * chip opens a summary popover (title, agent, status) and clicking restores
 * the pane — the PTY kept running, so it re-attaches via replay.
 */
function HiddenSessionsBar({
  sessions,
  flush,
  onRestore,
  onRestoreAll,
}: {
  sessions: OpenTerminal[];
  flush: boolean;
  onRestore: (taskId: string) => void;
  onRestoreAll: () => void;
}) {
  // Live task rows so titles/statuses keep updating while hidden (the store's
  // task is a snapshot from open time). Every session in the bar belongs to
  // the grid's scope, so one query covers all of them.
  const scopeProject = sessions[0]?.project;
  const { data: liveTasks } = useTasks(
    scopeProject?.id ?? "",
    scopeProject?.activeWorktreeId ?? null,
    scopeProject?.activeRuntimeScopeId ?? LOCAL_SCOPE_ID,
  );

  return (
    <div
      data-hidden-sessions-bar
      aria-label="Hidden sessions"
      style={{
        flexShrink: 0,
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: flush ? "7px 0 0" : "0 8px 4px",
        minWidth: 0,
        borderTop: flush ? "1px solid var(--border)" : "none",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          flex: 1,
          minWidth: 0,
          overflowX: "auto",
          // Chips carry their own visual bounds; keep the strip scrollable
          // without a visible scrollbar stealing height from the bar.
          scrollbarWidth: "none",
        }}
      >
        {sessions.map((session) => {
          const live = liveTasks?.find((t) => t.id === session.taskId) ?? session.task;
          const icon = isSessionIcon(live.icon) ? live.icon : DEFAULT_SESSION_ICON;
          const agentMeta = AGENT_META[live.agent];
          const statusMeta = STATUS_META[live.status];
          return (
            <Tooltip
              key={session.taskId}
              placement="top"
              content={
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  {/* Miniature of the pane header's icon tile, so the popover
                      reads as the hidden cell's identity card. */}
                  <div
                    style={{
                      width: 24,
                      height: 24,
                      borderRadius: 7,
                      flexShrink: 0,
                      background:
                        "linear-gradient(180deg, var(--surface-2), var(--surface-1))",
                      border: "1px solid var(--border)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: "var(--text-dim)",
                    }}
                  >
                    <SessionIcon name={icon} size={13} strokeWidth={1.6} />
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
                    <div style={{ fontWeight: 600 }}>{live.title}</div>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        fontFamily: "var(--mono)",
                        fontSize: 11,
                      }}
                    >
                      <span style={{ color: agentMeta.color }}>{agentMeta.label}</span>
                      <span style={{ color: "var(--text-dim)" }}>·</span>
                      <span style={{ color: statusMeta.color }}>{statusMeta.label}</span>
                    </div>
                  </div>
                </div>
              }
            >
              <button
                type="button"
                className="mc-hidden-chip"
                onClick={() => onRestore(session.taskId)}
                aria-label={`Restore session ${live.title}`}
              >
                <SessionIcon name={icon} size={12} strokeWidth={1.6} />
                <span
                  style={{
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    maxWidth: 140,
                  }}
                >
                  {live.title}
                </span>
                <StatusDot status={live.status} size={5} />
              </button>
            </Tooltip>
          );
        })}
      </div>
      {sessions.length > 1 && (
        <button
          type="button"
          className="mc-hidden-chip mc-hidden-restore-all"
          onClick={onRestoreAll}
        >
          Restore all
        </button>
      )}
    </div>
  );
}

/**
 * Grid of the current project/scope's open sessions, laid out as authored rows.
 * Each cell reuses TerminalPane (which carries its own title header + expand/
 * close controls). Every row sizes its own columns independently; expanding a
 * cell fills the grid; closing archives the session. Cards can be reordered by
 * dragging the handle rail at the top of each cell — within a row or across rows
 * — and the layout (order + per-row column widths + row heights) is persisted
 * per scope to localStorage.
 */
export function SessionGrid({
  scopeKey,
  emptyHeader,
}: {
  scopeKey: string;
  /** "Sessions" title row rendered above the empty state (all sessions hidden). */
  emptyHeader?: ReactNode;
}) {
  const {
    sessions,
    close,
    setPtyId,
    gridFocusRequest,
    takeCloneInsertAfter,
    takeNewRowRequest,
    takeSessionIdRenames,
    noteGridFocusedTask,
    activeTaskIdFor,
    consumeGridFocusRequest,
  } = useTerminals();
  const queryClient = useQueryClient();
  const userTerminals = useUserTerminals();
  const { bindings } = useKeybindings();
  const { data: settings } = useSettings();
  // The flat theme lays panes out flush + square: no gap between cells, no
  // outer padding. Painted keeps the spacious 8px grid. Fall back to the cached
  // style so first paint matches before settings hydrate. The divider hit-area
  // (HANDLE_HIT) stays a grabbable 8px, centred on the 0-width seam.
  const flushLayout =
    (settings?.themeStyle ?? readCachedThemeStyle()) === "flat";
  const gridGap = flushLayout ? 0 : GRID_GAP;
  const gridPad = flushLayout ? 0 : GRID_PADDING;
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);
  // Task whose cell is momentarily spotlighted after a notification "Open".
  const [focusedTaskId, setFocusedTaskId] = useState<string | null>(null);
  // Keyboard-navigation mode (Cmd/Ctrl+G): the selected cell, or null when off.
  const [navTaskId, setNavTaskId] = useState<string | null>(null);
  const [pendingArchive, setPendingArchive] = useState<OpenTerminal | null>(null);
  const [archiving, setArchiving] = useState(false);
  // Sessions the user has hidden with Cmd/Ctrl+L (terminal.close). Their pane is
  // pulled out of the grid but the PTY keeps running, so re-showing re-attaches
  // via replay — the grid's non-destructive answer to the single-panel view's
  // "hide session panel". Hidden sessions stay reachable in the restore bar
  // under the grid, and the set is persisted per scope so hides survive
  // leaving grid view and app restarts.
  const [hiddenTaskIds, setHiddenTaskIds] = useState<ReadonlySet<string>>(() =>
    loadHiddenTaskIds(scopeKey),
  );
  // The most recently hidden session, restored when Cmd/Ctrl+L fires with no
  // visible session left to hide (every session hidden) — mirrors the single-
  // panel toggle where a second press brings the last hidden session back.
  const lastHiddenTaskIdRef = useRef<string | null>(null);

  // Every session that belongs to this scope, hidden or not — the source of
  // truth for what may be hidden/restored and for pruning stale hidden ids.
  const allScopedSessions = useMemo(
    () => sessions.filter((s) => scopeKeyFor(s) === scopeKey),
    [sessions, scopeKey],
  );

  // Only this scope's *visible* sessions belong to the rendered grid (matches
  // the single-panel view's scoping) — so switching projects/worktrees shows a
  // different grid, and hidden sessions drop out of the layout entirely.
  const scopedSessions = useMemo(
    () => allScopedSessions.filter((s) => !hiddenTaskIds.has(s.taskId)),
    [allScopedSessions, hiddenTaskIds],
  );

  // The hidden sessions, most recently hidden first (Set preserves insertion
  // order; reversed so the newest hide lands leftmost in the restore bar).
  const hiddenSessions = useMemo(() => {
    if (hiddenTaskIds.size === 0) return [];
    const byId = new Map(allScopedSessions.map((s) => [s.taskId, s]));
    const out: OpenTerminal[] = [];
    for (const id of hiddenTaskIds) {
      const session = byId.get(id);
      if (session) out.unshift(session);
    }
    return out;
  }, [hiddenTaskIds, allScopedSessions]);

  // Drop hidden ids whose session is gone (archived/closed elsewhere) so a hide
  // never lingers and the empty-state math stays honest.
  useEffect(() => {
    setHiddenTaskIds((prev) => {
      if (prev.size === 0) return prev;
      const live = new Set(allScopedSessions.map((s) => s.taskId));
      let changed = false;
      const next = new Set<string>();
      for (const id of prev) {
        if (live.has(id)) next.add(id);
        else changed = true;
      }
      return changed ? next : prev;
    });
  }, [allScopedSessions]);

  // Persist the hidden set whenever it changes, so hides survive leaving grid
  // view and app restarts (the scope-swap block reloads it per scope).
  useEffect(() => {
    saveHiddenTaskIds(scopeKey, hiddenTaskIds);
  }, [scopeKey, hiddenTaskIds]);

  // The authored layout for the current scope. Reconciled against live sessions:
  // new sessions land in the current/new row, closed ones (and empty rows) are
  // pruned. Seeded from this scope's persisted layout.
  const [layout, setLayout] = useState<GridLayout>(() => loadGridLayout(scopeKey) ?? EMPTY_LAYOUT);
  // Live drag preview layout while a card is being dragged.
  const [dragLayout, setDragLayout] = useState<GridLayout | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const dragLayoutRef = useRef<GridLayout | null>(null);
  const cleanupDragRef = useRef<(() => void) | null>(null);
  // The scope / scoped-session set seen on the previous reconcile, so we can tell
  // a genuinely new session (a clone/create) apart from an id rename or a scope
  // switch when placing it in the layout.
  const prevScopeRef = useRef<string | null>(null);
  const prevIdsRef = useRef<Set<string>>(new Set());
  // Task id of the cell that most recently held focus — the "current row" anchor
  // a plain new session appends to. Tracked via a focusin listener because the
  // toolbar button steals focus on click (so document.activeElement is the
  // button, not a cell, by the time the session is created).
  const lastFocusedTaskIdRef = useRef<string | null>(null);
  // The layout currently painted on screen (kept in sync in the FLIP effect),
  // so drag math operates on exactly what the user sees and drops onto.
  const paintedLayoutRef = useRef<GridLayout>(layout);

  const [gridSize, setGridSize] = useState<{ width: number; height: number }>({
    width: 0,
    height: 0,
  });
  const [resizing, setResizing] = useState<"col" | "row" | null>(null);
  const resizeCleanupRef = useRef<(() => void) | null>(null);

  // Progressive pane mounting: how many panes may be mounted right now. Starts
  // at 0 — the first grid paint is just the empty cell frames — and grows every
  // frame (see the budget loop below) until nothing is deferred. Declared above
  // the scope swap so a project switch can reset it.
  const [paneMountBudget, setPaneMountBudget] = useState(0);

  // Switch scopes during render (React's "adjust state when a prop changes"
  // pattern) so the previous project's rows never paint for the new one — which
  // would flash the wrong layout and, worse, keep a stale expandedTaskId that
  // matches no new cell and hides every cell for a frame. The reconcile effect
  // below then prunes/places against the new scope's live sessions.
  const scopeSwapRef = useRef(scopeKey);
  if (scopeSwapRef.current !== scopeKey) {
    scopeSwapRef.current = scopeKey;
    setLayout(loadGridLayout(scopeKey) ?? EMPTY_LAYOUT);
    setHiddenTaskIds(loadHiddenTaskIds(scopeKey));
    lastHiddenTaskIdRef.current = null;
    setExpandedTaskId(null);
    setNavTaskId(null);
    setDragLayout(null);
    setDraggingId(null);
    dragLayoutRef.current = null;
    // Restart the progressive mount so the new scope's panes stream in a few
    // per frame instead of all mounting inside the switch's commit.
    setPaneMountBudget(0);
  }

  // Reconcile the layout against the scope's live sessions. On a scope switch,
  // reload that scope's saved layout (or seed a fresh square one) rather than
  // carrying the previous project's rows over. A layout effect so the placement
  // re-render happens before paint: a new (or renamed) session must never paint
  // in the transient trailing "extras" row — that one-frame squish is what the
  // FLIP effect would otherwise animate across every row.
  useLayoutEffect(() => {
    const renames = takeSessionIdRenames();
    const liveIds = scopedSessions.map((s) => s.taskId);
    const idSet = new Set(liveIds);
    const scopeChanged = prevScopeRef.current !== scopeKey;
    // A scope switch isn't a create, so it never consumes a clone/new-row request.
    const prevIds = scopeChanged ? new Set<string>() : prevIdsRef.current;
    const hasNewSession =
      !scopeChanged &&
      liveIds.some((id) => !prevIds.has(id) && !renames.some((r) => r.to === id));
    const cloneAfter = hasNewSession ? takeCloneInsertAfter() : null;
    const newRow = hasNewSession ? takeNewRowRequest() : false;
    const anchor = lastFocusedTaskIdRef.current;
    prevScopeRef.current = scopeKey;
    prevIdsRef.current = new Set(liveIds);

    setLayout((prev) => {
      const base = scopeChanged ? loadGridLayout(scopeKey) : prev;
      // Fresh scope with no saved layout: seed the near-square shape instead of
      // dumping every session into one row.
      const next =
        base === null || (scopeChanged && base.rows.length === 0)
          ? chunkIntoRows(liveIds)
          : reconcileLayout(base, liveIds, renames, { cloneAfter, newRow, anchor });
      if (!scopeChanged && layoutSig(next) === layoutSig(prev)) return prev;
      if (next.rows.length > 0) saveGridLayout(scopeKey, next);
      return next;
    });

    // A session removed out from under a stale expandedTaskId must not leave the
    // grid with reorder/resize disabled while no cell is visibly expanded. (The
    // scope-swap above already cleared transient state on a project change.)
    setExpandedTaskId((prev) => (prev && !idSet.has(prev) ? null : prev));
  }, [scopedSessions, scopeKey]);

  useEffect(() => () => cleanupDragRef.current?.(), []);
  useEffect(() => () => resizeCleanupRef.current?.(), []);

  // Track which cell most recently held focus, to anchor "current row" appends.
  useEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    const onFocusIn = () => {
      const id = (
        document.activeElement?.closest("[data-grid-cell]") as HTMLElement | null
      )?.getAttribute("data-task-id");
      if (id) {
        lastFocusedTaskIdRef.current = id;
        // Also surface it to the store so the project route can anchor a new
        // session beside this pane even after a toolbar-button click.
        noteGridFocusedTask(id);
      }
    };
    el.addEventListener("focusin", onFocusIn);
    return () => el.removeEventListener("focusin", onFocusIn);
  }, [noteGridFocusedTask]);

  // Spotlight a cell — either a notification's "Open" landing on a grid session,
  // or a freshly created/cloned session that should take the caret. Make it
  // visible (collapse an unrelated expanded cell), scroll it into view, focus its
  // terminal so the user can type immediately, and ring it briefly.
  useEffect(() => {
    if (!gridFocusRequest) return;
    // Claim the request exactly once (store-side ref): the request state lingers
    // after this effect runs, and the grid remounts across project switches —
    // without the claim a stale request would replay on mount and un-hide the
    // (possibly deliberately hidden) session it targeted.
    if (!consumeGridFocusRequest(gridFocusRequest.nonce)) return;
    const { taskId } = gridFocusRequest;
    // The request may target a session hidden with Cmd/Ctrl+L (e.g. it finished
    // while hidden and the user clicked the notification's "Open") — restore it
    // first so there is a cell to spotlight. Setter + ref are stable, so this
    // adds no effect deps.
    setHiddenTaskIds((prev) => {
      if (!prev.has(taskId)) return prev;
      const next = new Set(prev);
      next.delete(taskId);
      return next;
    });
    if (lastHiddenTaskIdRef.current === taskId) lastHiddenTaskIdRef.current = null;
    // A spotlight targets one session — end any keyboard-nav selection so its
    // dimming/ring doesn't fight the spotlight and Enter can't open a stale pick.
    setNavTaskId(null);
    setExpandedTaskId((prev) => (prev && prev !== taskId ? null : prev));
    setFocusedTaskId(taskId);

    // A brand-new session's pane can mount a few frames late (progressive mount)
    // and then rebuild once as it persists (awaitingCreate → persisted), which
    // discards the textarea we just focused. So poll briefly and re-assert focus
    // rather than making the single attempt an already-mounted session needs —
    // that single attempt is exactly why the clone didn't reliably take focus
    // once the grid held many sessions. Stop early if the user moves the caret
    // into a different cell so we never fight a deliberate click.
    const selector = `[data-grid-cell][data-task-id="${CSS.escape(taskId)}"]`;
    let scrolled = false;
    let focusedOnce = false;
    let attempts = 0;
    const MAX_ATTEMPTS = 24; // ~2.2s at the 90ms cadence below
    let poll = 0;
    const step = () => {
      const active = document.activeElement;
      const activeId = (
        active instanceof HTMLElement ? active.closest("[data-grid-cell]") : null
      )?.getAttribute("data-task-id");
      // Only after the caret has landed in the target once do we treat focus in
      // another cell as a deliberate move and back off — at the start it still
      // sits on the source pane the clone was triggered from, which is expected.
      if (focusedOnce && activeId && activeId !== taskId) return;
      const cell = gridRef.current?.querySelector<HTMLElement>(selector);
      if (cell && !scrolled) {
        cell.scrollIntoView({ block: "nearest", behavior: "smooth" });
        scrolled = true;
      }
      const textarea = cell?.querySelector<HTMLTextAreaElement>(".xterm-helper-textarea");
      if (textarea && active !== textarea) textarea.focus({ preventScroll: true });
      if (textarea && document.activeElement === textarea) focusedOnce = true;
      if (++attempts < MAX_ATTEMPTS) poll = window.setTimeout(step, 90);
    };
    poll = window.setTimeout(step, 0);

    const timer = window.setTimeout(
      () => setFocusedTaskId((prev) => (prev === taskId ? null : prev)),
      2200,
    );
    return () => {
      window.clearTimeout(poll);
      window.clearTimeout(timer);
    };
  }, [gridFocusRequest, consumeGridFocusRequest]);

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

  // Move the caret into a grid cell's terminal (after the layout settles) so the
  // user can type in it straight away, mirroring a click. Only touches gridRef,
  // so it's stable and safe to call from any of the close/expand handlers.
  const focusSessionTerminal = useCallback((taskId: string) => {
    requestAnimationFrame(() => {
      const selector = `[data-grid-cell][data-task-id="${CSS.escape(taskId)}"]`;
      gridRef.current
        ?.querySelector<HTMLElement>(selector)
        ?.querySelector<HTMLTextAreaElement>(".xterm-helper-textarea")
        ?.focus({ preventScroll: true });
    });
  }, []);

  // The session that should take over when `taskId`'s cell closes: its left/
  // previous neighbour in the on-screen reading order (rows top-to-bottom, cells
  // left-to-right), falling back to the next cell when the first one is closed.
  // Read from the live DOM — which is rendered in exactly that order — before the
  // closing cell is removed, so the grid never lands on "nothing active".
  const neighbourAfterClose = useCallback((taskId: string): string | null => {
    const cells = gridRef.current?.querySelectorAll<HTMLElement>("[data-grid-cell]");
    if (!cells) return null;
    const ids = Array.from(cells)
      .map((c) => c.getAttribute("data-task-id"))
      .filter((id): id is string => id !== null);
    const idx = ids.indexOf(taskId);
    if (idx < 0) return null;
    return ids[idx - 1] ?? ids[idx + 1] ?? null;
  }, []);

  // Close + archive one session (works across projects). Hand activation to the
  // closing cell's neighbour so the grid keeps a focused session instead of
  // going inert: `close` promotes it to the project's active session (for the
  // single-panel view) and we move the caret into its terminal (for the grid).
  const archiveSession = useCallback(
    async (session: OpenTerminal) => {
      const activateTaskId = neighbourAfterClose(session.taskId);
      try {
        await archiveOpenSession(session, close, queryClient, { activateTaskId });
      } catch (e: unknown) {
        toast.error(e instanceof Error ? e.message : "Could not archive session");
      }
      if (activateTaskId) focusSessionTerminal(activateTaskId);
    },
    [close, queryClient, neighbourAfterClose, focusSessionTerminal],
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
    const session = scopedSessions.find((s) => s.taskId === taskId);
    if (session) requestClose(session);
  }, [userTerminals.panelOpen, expandedTaskId, scopedSessions, requestClose]);

  useEffect(() => {
    const electron = getElectron();
    if (!electron || scopedSessions.length === 0) return;
    return electron.onCloseIntent(handleCloseIntent);
  }, [scopedSessions.length, handleCloseIntent]);

  useHotkey("session.closeWindow", handleCloseIntent, {
    enabled: !isElectron() && scopedSessions.length > 0,
    capture: true,
  });

  // Un-hide one session (bar chip click, or Cmd/Ctrl+L's restore fallback):
  // put its pane back in the grid and hand it the caret so the restore feels
  // like switching to it, not just re-adding a cell.
  const restoreHiddenSession = useCallback(
    (taskId: string) => {
      setHiddenTaskIds((prev) => {
        if (!prev.has(taskId)) return prev;
        const next = new Set(prev);
        next.delete(taskId);
        return next;
      });
      if (lastHiddenTaskIdRef.current === taskId) lastHiddenTaskIdRef.current = null;
      focusSessionTerminal(taskId);
    },
    [focusSessionTerminal],
  );

  // Un-hide everything at once (the bar's "Restore all"), focusing the most
  // recently hidden session — the one the user is most likely coming back for.
  const restoreAllHidden = useCallback(() => {
    const ids = Array.from(hiddenTaskIds);
    if (ids.length === 0) return;
    const focusId = lastHiddenTaskIdRef.current ?? ids[ids.length - 1];
    setHiddenTaskIds(new Set());
    lastHiddenTaskIdRef.current = null;
    if (focusId) focusSessionTerminal(focusId);
  }, [hiddenTaskIds, focusSessionTerminal]);

  // Cmd/Ctrl+L (terminal.close) in grid view: hide the focused cell's session —
  // pull its pane out of the grid without archiving it (the PTY keeps running
  // and re-attaches when it comes back). This is the grid's take on the normal
  // view's "hide session panel", but per focused cell since the grid shows every
  // session at once. The project route's own terminal.close handler no-ops while
  // the grid is on screen so this one drives it (mirrors session.cycle*). A
  // focused user terminal claims the shortcut first (matches handleCloseIntent).
  // Only with no visible session left — every session already hidden — the most
  // recently hidden session is restored, giving the single-panel toggle feel.
  const handleHideIntent = useCallback(() => {
    if (userTerminals.panelOpen && isUserTerminalXtermFocused()) return;
    const focusedCell = document.activeElement?.closest("[data-grid-cell]");
    // The session the chord means by "current": the cell owning the caret, else
    // the expanded cell, else — when nothing in the grid holds focus, e.g. right
    // after switching back to this project — the last-focused cell, then the
    // scope's persisted active session, then the first visible cell. Candidates
    // must be visible in this scope (a stale ref from another project, or an
    // active id that is itself hidden, falls through to the next).
    const candidates = [
      focusedCell?.getAttribute("data-task-id"),
      expandedTaskId,
      lastFocusedTaskIdRef.current,
      activeTaskIdFor(scopeKey),
      scopedSessions[0]?.taskId,
    ];
    const taskId = candidates.find(
      (id): id is string => !!id && scopedSessions.some((s) => s.taskId === id),
    );
    const target = taskId ? scopedSessions.find((s) => s.taskId === taskId) : undefined;
    if (target) {
      // Hand focus to the hiding cell's neighbour (read before removal) so the
      // grid keeps a focused pane instead of going inert — mirrors archive.
      const neighbour = neighbourAfterClose(target.taskId);
      if (expandedTaskId === target.taskId) setExpandedTaskId(null);
      lastHiddenTaskIdRef.current = target.taskId;
      setHiddenTaskIds((prev) => {
        const next = new Set(prev);
        next.add(target.taskId);
        return next;
      });
      if (neighbour) focusSessionTerminal(neighbour);
      return;
    }
    // The ref only lives for this mount; after a reload (or view switch) fall
    // back to the most recently hidden id in the persisted set.
    const remembered = lastHiddenTaskIdRef.current;
    const restore =
      remembered && hiddenTaskIds.has(remembered)
        ? remembered
        : Array.from(hiddenTaskIds).at(-1);
    if (!restore) return;
    restoreHiddenSession(restore);
  }, [
    userTerminals.panelOpen,
    expandedTaskId,
    scopedSessions,
    scopeKey,
    activeTaskIdFor,
    hiddenTaskIds,
    neighbourAfterClose,
    focusSessionTerminal,
    restoreHiddenSession,
  ]);

  // Capture phase so a focused xterm surface can't swallow the chord first —
  // mirrors how session.closeWindow / session.cycle* are wired here.
  useHotkey("terminal.close", handleHideIntent, {
    enabled: allScopedSessions.length > 0,
    capture: true,
  });

  // The layout to render (drag preview takes precedence over the saved layout),
  // resolved to actual sessions. Any scoped session not yet placed (the frame
  // before reconcile runs) shows in a trailing row so it never flashes missing.
  const activeLayout = dragLayout ?? layout;
  const sessionById = useMemo(
    () => new Map(scopedSessions.map((s) => [s.taskId, s])),
    [scopedSessions],
  );
  const { viewRows, hasUnplaced } = useMemo(() => {
    const seen = new Set<string>();
    const rows = activeLayout.rows
      .map((r, ri) => {
        const cells = r.cells
          .map((id, ci) => {
            const session = sessionById.get(id);
            return session ? { session, fr: r.colSizes[ci] ?? 1 } : null;
          })
          .filter((c): c is { session: OpenTerminal; fr: number } => c !== null);
        cells.forEach((c) => seen.add(c.session.taskId));
        return { cells, fr: activeLayout.rowSizes[ri] ?? 1 };
      })
      .filter((r) => r.cells.length > 0);
    const extras = scopedSessions.filter((s) => !seen.has(s.taskId));
    if (extras.length > 0) {
      rows.push({ cells: extras.map((s) => ({ session: s, fr: 1 })), fr: 1 });
    }
    return { viewRows: rows, hasUnplaced: extras.length > 0 };
  }, [activeLayout, sessionById, scopedSessions]);

  const visibleSessions = useMemo(
    () => viewRows.flatMap((r) => r.cells.map((c) => c.session)),
    [viewRows],
  );

  // Cycle focus to the next/previous session in on-screen reading order (rows
  // top-to-bottom, cells left-to-right), wrapping around. This is the grid's
  // answer to session.cycleNext/cyclePrev: in the normal view those chords swap
  // the single visible pane, but the grid shows every pane at once, so cycling
  // means moving the caret between cells — the same thing a click does. The
  // project route's own handler for these actions no-ops in grid view so this
  // one drives it. Anchors on the cell that currently owns the caret, falling
  // back to the last-focused cell, then the first session.
  const cycleFocusedSession = useCallback(
    (delta: 1 | -1) => {
      const ids = visibleSessions.map((s) => s.taskId);
      if (ids.length < 2) return;
      const focusedId =
        (document.activeElement?.closest("[data-grid-cell]") as HTMLElement | null)?.getAttribute(
          "data-task-id",
        ) ?? lastFocusedTaskIdRef.current;
      const curIdx = focusedId ? ids.indexOf(focusedId) : -1;
      const nextIdx =
        curIdx === -1
          ? delta === 1
            ? 0
            : ids.length - 1
          : (curIdx + delta + ids.length) % ids.length;
      const nextId = ids[nextIdx];
      if (!nextId || nextId === focusedId) return;
      // A cycle is a deliberate move: drop any keyboard-nav selection and collapse
      // an unrelated expanded cell so the target is actually on screen.
      setNavTaskId(null);
      setExpandedTaskId((prev) => (prev && prev !== nextId ? null : prev));
      const selector = `[data-grid-cell][data-task-id="${CSS.escape(nextId)}"]`;
      requestAnimationFrame(() => {
        const cell = gridRef.current?.querySelector<HTMLElement>(selector);
        cell?.scrollIntoView({ block: "nearest", behavior: "smooth" });
        cell
          ?.querySelector<HTMLTextAreaElement>(".xterm-helper-textarea")
          ?.focus({ preventScroll: true });
      });
    },
    [visibleSessions],
  );

  // Capture phase so a focused xterm surface can't swallow the chord first —
  // mirrors how the project route wires these same actions in the normal view.
  useHotkey("session.cycleNext", () => cycleFocusedSession(1), { capture: true });
  useHotkey("session.cyclePrev", () => cycleFocusedSession(-1), { capture: true });

  // Progressive mount: cells beyond the budget render as empty frames and fill
  // in over the following frames. Panes with a cached surface used to bypass
  // the budget ("just a DOM re-parent"), but reattaching also refits the xterm
  // and re-acquires a GPU renderer — so returning to a project with many parked
  // sessions remounted every pane in one synchronous commit and froze the
  // switch for its whole duration. Staggering ALL panes keeps each frame's work
  // bounded: the grid paints instantly and cells stream in a few per frame.
  let panesSeen = 0;
  let deferredPaneCount = 0;
  const mountedByTask = new Map<string, boolean>();
  for (const session of visibleSessions) {
    const mounted = panesSeen++ < paneMountBudget;
    if (!mounted) deferredPaneCount += 1;
    mountedByTask.set(session.taskId, mounted);
  }
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
  // opening/closing, expand toggles, row changes) each card glides from its
  // previous rect to the new one instead of snapping. Runs on every commit —
  // non-reorder renders only refresh the measured baseline so divider/window
  // resizes never animate, and a card already mid-flight continues from where it
  // visually is. The row structure joins the signature so a cell that changes
  // rows animates too.
  const cellRectsRef = useRef<Map<string, DOMRect>>(new Map());
  const flipSigRef = useRef<string | null>(null);
  const orderSig = viewRows.map((r) => r.cells.map((c) => c.session.taskId).join(",")).join("|");
  const flipSig = `${expandedTaskId ?? ""}::${orderSig}`;
  // Everything that can move a cell's box: order/expand, the grid's pixel size,
  // the gap/pad, and the painted track weights. A background session status tick
  // re-renders the grid without touching any of these — when the signature is
  // unchanged (and no drag/animation is live) the measurement below would read
  // every cell's rect purely to re-store identical values, so we skip it.
  const lastGeomSigRef = useRef<string | null>(null);
  const geomSig = `${flipSig}#${gridSize.width}x${gridSize.height}#${gridGap}/${gridPad}#${activeLayout.rowSizes.join(
    ",",
  )}#${activeLayout.rows.map((r) => r.colSizes.join(".")).join("_")}`;
  useLayoutEffect(() => {
    // Keep the painted-layout ref in sync so drag math sees what's on screen.
    paintedLayoutRef.current = activeLayout;
    // A commit with a session the layout hasn't placed yet (the trailing extras
    // row) is transient: the reconcile layout-effect above re-renders it away
    // before the browser paints. Keep the FLIP baseline (signature + rects) at
    // the last painted state so the placed commit animates a single step from
    // what the user actually saw — a new session then only moves the row it
    // lands in, instead of squishing every row toward the phantom extras row.
    if (hasUnplaced) {
      positionDraggedCell();
      return;
    }
    const animate = flipSigRef.current !== null && flipSigRef.current !== flipSig;
    flipSigRef.current = flipSig;
    // Nothing geometric changed and nothing is animating/dragging: the stored
    // rects are still valid, so skip the forced-layout measurement entirely.
    const dragging = dragVisualRef.current !== null;
    if (!animate && !dragging && geomSig === lastGeomSigRef.current) return;
    lastGeomSigRef.current = geomSig;
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

  const reorderEnabled = !expandedTaskId && visibleSessions.length > 1;

  // Pixel space the row-height tracks share, once outer padding + gaps are gone.
  const totalRowFr = layout.rowSizes.reduce((a, b) => a + b, 0) || 1;
  const availH = Math.max(
    0,
    gridSize.height - gridPad * 2 - Math.max(0, layout.rows.length - 1) * gridGap,
  );
  // Pixel top/height of a row's band (for the per-row column divider handles).
  const rowBand = useCallback(
    (rowIndex: number): { top: number; height: number } => {
      let accFrac = 0;
      for (let k = 0; k < rowIndex; k++) accFrac += (layout.rowSizes[k] ?? 0) / totalRowFr;
      const top = gridPad + accFrac * availH + rowIndex * gridGap;
      const height = ((layout.rowSizes[rowIndex] ?? 0) / totalRowFr) * availH;
      return { top, height };
    },
    [layout.rowSizes, totalRowFr, availH, gridPad, gridGap],
  );
  // Horizontal pixel space a row's column tracks share (every row spans the full
  // grid width, so this only depends on the cell count).
  const rowAvailW = useCallback(
    (cellCount: number): number =>
      Math.max(0, gridSize.width - gridPad * 2 - Math.max(0, cellCount - 1) * gridGap),
    [gridSize.width, gridPad, gridGap],
  );
  const resizeEnabled =
    !expandedTaskId && !dragLayout && visibleSessions.length > 1 && gridSize.width > 0;

  // Left/top pixel offset of the divider after track `index` (0-based).
  const dividerOffset = useCallback(
    (sizes: number[], avail: number, index: number): number => {
      const total = sizes.reduce((a, b) => a + b, 0) || 1;
      let before = 0;
      for (let k = 0; k <= index; k++) before += sizes[k] ?? 0;
      return gridPad + (before / total) * avail + index * gridGap + gridGap / 2;
    },
    [gridPad, gridGap],
  );

  // Drag a divider: move the boundary between two tracks, scaling each side's
  // tracks proportionally so the whole row/column of cells follows the divider.
  // `axis: "row"` resizes the shared row heights; `axis: "col"` resizes only the
  // columns of the given row (rowIndex), so a divider drag stays inside its row.
  // The live layout updates per move; only the release persists.
  const startResize = useCallback(
    (
      axis: "col" | "row",
      rowIndex: number | null,
      index: number,
      event: ReactPointerEvent<HTMLDivElement>,
    ) => {
      if (event.button !== 0) return;
      event.preventDefault();
      resizeCleanupRef.current?.();
      const pointerId = event.pointerId;
      const handleEl = event.currentTarget;
      const isCol = axis === "col";
      const startSizes = (
        isCol ? layout.rows[rowIndex ?? -1]?.colSizes : layout.rowSizes
      )?.slice();
      if (!startSizes) return;
      const avail = isCol ? rowAvailW(startSizes.length) : availH;
      if (avail <= 0 || index < 0 || index + 1 >= startSizes.length) return;
      try {
        handleEl.setPointerCapture(pointerId);
      } catch {
        /* element may be gone */
      }
      const total = startSizes.reduce((a, b) => a + b, 0) || 1;
      const startPos = isCol ? event.clientX : event.clientY;
      const before = startSizes.slice(0, index + 1);
      const after = startSizes.slice(index + 1);
      const beforeTotal = before.reduce((a, b) => a + b, 0);
      const afterTotal = total - beforeTotal;
      const minFr = (MIN_CELL_PX / avail) * total;
      // Scaling a side keeps its tracks' ratios, so the side bottoms out when
      // its smallest track hits the minimum cell size.
      const minBeforeTotal = beforeTotal * (minFr / Math.min(...before));
      const minAfterTotal = afterTotal * (minFr / Math.min(...after));
      // A grid too tight to honor the minimum on both sides can't resize.
      if (minBeforeTotal + minAfterTotal >= total) return;

      const writeSizes = (prev: GridLayout, sizes: number[]): GridLayout => {
        const copy = cloneLayout(prev);
        if (isCol) {
          const row = copy.rows[rowIndex ?? -1];
          if (row) row.colSizes = sizes;
        } else {
          copy.rowSizes = sizes;
        }
        return copy;
      };

      let latest = startSizes;
      const apply = (pos: number) => {
        const deltaFr = ((pos - startPos) / avail) * total;
        const nextBeforeTotal = Math.max(
          minBeforeTotal,
          Math.min(total - minAfterTotal, beforeTotal + deltaFr),
        );
        const beforeScale = nextBeforeTotal / beforeTotal;
        const afterScale = (total - nextBeforeTotal) / afterTotal;
        const next = [
          ...before.map((s) => s * beforeScale),
          ...after.map((s) => s * afterScale),
        ];
        latest = next;
        setLayout((prev) => writeSizes(prev, next));
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
        setLayout((prev) => {
          const next = writeSizes(prev, latest);
          saveGridLayout(scopeKey, next);
          return next;
        });
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
    [layout, availH, rowAvailW, scopeKey],
  );

  // The (rowIndex, cellIndex) insertion slot under the pointer. Reads DOM row/
  // cell layout positions (offsetTop/Left, relative to the positioned grid since
  // the row containers are non-positioned) rather than bounding rects — a cell
  // mid-FLIP reports a transformed rect. Indices map 1:1 onto the painted layout.
  const resolveDropTarget = useCallback(
    (clientX: number, clientY: number): { rowIndex: number; cellIndex: number } | null => {
      const grid = gridRef.current;
      const rowEls = grid?.querySelectorAll<HTMLElement>("[data-grid-row]");
      if (!grid || !rowEls || rowEls.length === 0) return null;
      const gridRect = grid.getBoundingClientRect();
      const x = clientX - gridRect.left;
      const y = clientY - gridRect.top;
      let rowIndex = -1;
      for (let i = 0; i < rowEls.length; i++) {
        const el = rowEls[i]!;
        if (y >= el.offsetTop && y <= el.offsetTop + el.offsetHeight) {
          rowIndex = i;
          break;
        }
      }
      if (rowIndex < 0) rowIndex = y < rowEls[0]!.offsetTop ? 0 : rowEls.length - 1;
      const cellEls = rowEls[rowIndex]!.querySelectorAll<HTMLElement>("[data-grid-cell]");
      let cellIndex = cellEls.length;
      for (let i = 0; i < cellEls.length; i++) {
        const cell = cellEls[i]!;
        if (x < cell.offsetLeft + cell.offsetWidth / 2) {
          cellIndex = i;
          break;
        }
      }
      return { rowIndex, cellIndex };
    },
    [],
  );

  // Move keyboard focus into a session's terminal so the user can type right
  // away — after the reordered cells have settled into their new DOM positions.
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
      if (taskId && scopedSessions.some((s) => s.taskId === taskId)) toggleExpanded(taskId);
    };
    window.addEventListener(GRID_EXPAND_TOGGLE_EVENT, onToggle);
    return () => window.removeEventListener(GRID_EXPAND_TOGGLE_EVENT, onToggle);
  }, [expandedTaskId, scopedSessions, toggleExpanded]);

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
    const idx = visibleSessions.findIndex((s) => s.taskId === navTaskId);
    return idx < 0 ? "" : `Session ${idx + 1} of ${visibleSessions.length} selected`;
  }, [navTaskId, visibleSessions]);

  const enterGridNav = useCallback(() => {
    const ids = visibleSessions.map((s) => s.taskId);
    // Start on the cell that currently owns focus, else the first session. Focus
    // is left where it is — the capture listener intercepts nav keys, and keeping
    // the terminal focused keeps Cmd/Ctrl+W and cancel behaving normally.
    const originId = document.activeElement
      ?.closest("[data-grid-cell]")
      ?.getAttribute("data-task-id");
    const startId = originId && ids.includes(originId) ? originId : ids[0] ?? null;
    if (startId) setNavTaskId(startId);
  }, [visibleSessions]);

  // Move the selection by on-screen geometry rather than index math: rows can
  // have different column counts and resized tracks, so `row*columns + col` no
  // longer maps to a cell. Reading real cell centres handles both. Pick the
  // nearest cell in the requested direction, strongly preferring ones lined up
  // on the perpendicular axis (same row for left/right, same column for up/down);
  // with none in that direction the selection holds.
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
    if (
      expandedTaskId ||
      scopedSessions.length < 2 ||
      !scopedSessions.some((s) => s.taskId === navTaskId)
    ) {
      setNavTaskId(null);
    }
  }, [navTaskId, expandedTaskId, scopedSessions]);

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
    if (expandedTaskId || scopedSessions.length < 2) return;
    enterGridNav();
  };

  useEffect(() => {
    if (scopedSessions.length === 0) return;
    const handler = (e: KeyboardEvent) => onNavKeyRef.current(e);
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [scopedSessions.length]);

  const startPointerReorder = useCallback(
    (taskId: string, event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      cleanupDragRef.current?.();

      // A press that lands on a header button (rename, expand, close) must not
      // steal focus into the terminal — let those controls do their own thing.
      const startedOnControl = !!(event.target as HTMLElement | null)?.closest(
        "button, a, input, textarea",
      );

      dragLayoutRef.current = cloneLayout(paintedLayoutRef.current);
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
        // Operate on the layout that's actually painted, so DOM-read drop
        // targets and the moved structure always agree even mid-repaint.
        const base = paintedLayoutRef.current;
        const src = findCell(base.rows, taskId);
        const target = resolveDropTarget(clientX, clientY);
        if (!src || !target) return;
        const next = moveCellInLayout(base, src.row, src.col, target.rowIndex, target.cellIndex);
        if (!next || layoutSig(next) === layoutSig(base)) return;
        dragLayoutRef.current = next;
        setDragLayout(next);
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
        const finalLayout = dragLayoutRef.current;
        if (commit && drag.moved && finalLayout) {
          setLayout(finalLayout);
          saveGridLayout(scopeKey, finalLayout);
        }
        dragLayoutRef.current = null;
        setDragLayout(null);
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
    [resolveDropTarget, positionDraggedCell, focusSessionTerminal, scopeKey],
  );

  const hiddenBar =
    hiddenSessions.length > 0 ? (
      <HiddenSessionsBar
        sessions={hiddenSessions}
        flush={flushLayout}
        onRestore={restoreHiddenSession}
        onRestoreAll={restoreAllHidden}
      />
    ) : null;

  // The project route only mounts the grid once the scope has a session, so an
  // empty grid usually means a transient frame — unless the user hid every
  // session, in which case the restore bar must stay reachable.
  if (scopedSessions.length === 0) {
    return (
      <>
        {/* Grid mode leaves 12px under the project header where the list view
            leaves 32px — pad the difference so the header sits identically. */}
        {emptyHeader != null && <div style={{ marginTop: 20 }}>{emptyHeader}</div>}
        <div
          style={{
            flex: 1,
            minHeight: 0,
            overflow: "auto",
            paddingInline: 12,
            boxSizing: "border-box",
          }}
        >
          <EmptyState
            title={hiddenSessions.length > 0 ? "All sessions hidden" : "No active sessions"}
            subtitle={
              hiddenSessions.length > 0
                ? "Click a session in the bar below to bring it back."
                : "Start a new session to begin working on this project."
            }
            action={
              hiddenSessions.length > 0 ? (
                // mc-btn-new-session gives the outlined accent look the list
                // view's empty-state "New session" button has.
                <Btn
                  variant="primary"
                  icon="eye"
                  className="mc-btn-new-session"
                  onClick={restoreAllHidden}
                >
                  Restore all ({hiddenSessions.length})
                </Btn>
              ) : undefined
            }
          />
        </div>
        {hiddenBar}
      </>
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
          gridTemplateColumns: "minmax(0, 1fr)",
          gridTemplateRows: frTracks(viewRows.map((r) => r.fr)) || "minmax(0, 1fr)",
          gap: gridGap,
          padding: gridPad,
          overflow: "hidden",
        }}
      >
        {viewRows.map((row, ri) => (
          <div
            key={`row-${ri}`}
            data-grid-row={String(ri)}
            style={{
              display: "grid",
              gridTemplateColumns: frTracks(row.cells.map((c) => c.fr)),
              gap: gridGap,
              minWidth: 0,
              minHeight: 0,
            }}
          >
            {row.cells.map(({ session }) => {
              const cellScopeKey = scopeKeyFor(session);
              const isExpandedCell = expandedTaskId === session.taskId;
              const isDragging = draggingId === session.taskId;
              return (
                <GridCell
                  key={`${session.taskId}:${cellScopeKey}`}
                  session={session}
                  scopeKey={cellScopeKey}
                  mounted={mountedByTask.get(session.taskId) ?? true}
                  expanded={isExpandedCell}
                  hidden={expandedTaskId !== null && !isExpandedCell}
                  isDragging={isDragging}
                  isFocused={!isDragging && focusedTaskId === session.taskId}
                  isNavSelected={navTaskId === session.taskId}
                  navActive={navActive}
                  reorderEnabled={reorderEnabled}
                  gridPadding={gridPad}
                  onToggleExpanded={toggleExpanded}
                  onRequestClose={requestClose}
                  onPtyReady={setPtyId}
                  onHeaderPointerDown={startPointerReorder}
                />
              );
            })}
          </div>
        ))}
        {resizeEnabled && (
          <>
            {/* Row-height dividers (shared across the whole width). */}
            {Array.from({ length: Math.max(0, layout.rows.length - 1) }).map((_, i) => (
              <div
                key={`rowdiv-${i}`}
                onPointerDown={(e) => startResize("row", null, i, e)}
                style={{
                  position: "absolute",
                  top: dividerOffset(layout.rowSizes, availH, i),
                  left: gridPad,
                  right: gridPad,
                  height: HANDLE_HIT,
                  transform: "translateY(-50%)",
                  cursor: "row-resize",
                  zIndex: 6,
                  touchAction: "none",
                }}
              />
            ))}
            {/* Per-row column dividers — each stays inside its own row's band. */}
            {layout.rows.map((row, ri) => {
              const band = rowBand(ri);
              const avail = rowAvailW(row.cells.length);
              return Array.from({ length: Math.max(0, row.cells.length - 1) }).map((_, j) => (
                <div
                  key={`coldiv-${ri}-${j}`}
                  onPointerDown={(e) => startResize("col", ri, j, e)}
                  style={{
                    position: "absolute",
                    left: dividerOffset(row.colSizes, avail, j),
                    top: band.top,
                    height: band.height,
                    width: HANDLE_HIT,
                    transform: "translateX(-50%)",
                    cursor: "col-resize",
                    zIndex: 6,
                    touchAction: "none",
                  }}
                />
              ));
            })}
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
      {hiddenBar}
      <ConfirmDialog
        open={!!pendingArchive}
        onClose={() => setPendingArchive(null)}
        onConfirm={confirmArchive}
        title="Archive running session?"
        confirmLabel="Archive"
        cancelLabel="Keep running"
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
