import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CardFrame } from "~/components/ui/CardFrame";
import { AGENT_META } from "~/lib/design-meta";
import {
  GRID_COLUMN_OPTIONS,
  requestGridSort,
  saveGridColumnLimit,
} from "~/lib/grid-layout-prefs";
import { Z_INDEX } from "~/lib/z-index";
import type { TaskAgent } from "~/shared/domain";

// The width options as the arrow keys walk them: Auto, then 1..6.
const WIDTH_STEPS: Array<number | null> = [null, ...GRID_COLUMN_OPTIONS];

/**
 * Keyboard-first popup opened by the session.gridLayout shortcut. Two stacked
 * sections share one focus: the width row (sessions per row) and the sort
 * options. ←/→ step the width through Auto,1..6 — each step applies LIVE so
 * the grid reflows behind the popup; 1–6 (or A/0 for auto) jump straight to a
 * width and close; ↑/↓ move between the width row and the sort options; Enter
 * applies the focused sort (or just closes on the width row, whose value is
 * already applied); Esc closes. It's the quick-hands twin of the header's
 * grid-layout dropdown, sharing the same prefs/sort plumbing.
 *
 * Keys are intercepted in the capture phase so a focused terminal never sees
 * them; any key the picker doesn't handle closes it and falls through to its
 * real target (mirrors the grid's navigation mode).
 */
export function GridLayoutQuickPicker({
  open,
  onClose,
  scopeKey,
  currentLimit,
  agents,
}: {
  open: boolean;
  onClose: () => void;
  scopeKey: string;
  /** The scope's active sessions-per-row lock (null = auto). */
  currentLimit: number | null;
  /** Agents with open sessions in the scope, in registry order. */
  agents: TaskAgent[];
}) {
  const cardRef = useRef<HTMLElement>(null);
  // Focused row: 0 = the width chips, 1..agents.length = a sort option.
  const [focusRow, setFocusRow] = useState(0);
  const sortable = agents.length > 1;
  const rowCount = 1 + (sortable ? agents.length : 0);

  // Fresh focus each open.
  useEffect(() => {
    if (open) setFocusRow(0);
  }, [open]);

  const pickLimit = (limit: number | null) => {
    saveGridColumnLimit(scopeKey, limit);
    onClose();
  };
  // Arrow-stepping applies live and keeps the popup open, so the user can
  // watch the grid reflow behind it and keep stepping. Steps read the last
  // committed value from props: the save fires the prefs event, the grid's
  // listener updates its state, and the re-render lands well inside the
  // ~30ms between key repeats, so each step sees the previous one.
  const stepLimit = (delta: 1 | -1) => {
    const idx = WIDTH_STEPS.findIndex((o) => o === currentLimit);
    const next = Math.max(0, Math.min(WIDTH_STEPS.length - 1, (idx < 0 ? 0 : idx) + delta));
    saveGridColumnLimit(scopeKey, WIDTH_STEPS[next] ?? null);
  };
  const applySort = (agent: TaskAgent | undefined) => {
    if (!agent) return;
    requestGridSort(scopeKey, agent);
    onClose();
  };

  // Capture-phase keys while open — refreshed via ref so the listener
  // subscribes once per open and never closes over stale state.
  const onKeyRef = useRef<(e: KeyboardEvent) => void>(() => {});
  onKeyRef.current = (e: KeyboardEvent) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return; // let chords through (incl. the toggle)
    const claim = () => {
      e.preventDefault();
      e.stopPropagation();
    };
    if (e.key >= "1" && e.key <= "6") {
      claim();
      pickLimit(Number(e.key));
      return;
    }
    if (e.key === "0" || e.key.toLowerCase() === "a") {
      claim();
      pickLimit(null);
      return;
    }
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      claim();
      // Horizontal always means the width row — pull focus back onto it.
      setFocusRow(0);
      stepLimit(e.key === "ArrowRight" ? 1 : -1);
      return;
    }
    if (rowCount > 1 && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      claim();
      const delta = e.key === "ArrowDown" ? 1 : -1;
      setFocusRow((r) => (r + delta + rowCount) % rowCount);
      return;
    }
    if (e.key === "Enter") {
      claim();
      // The width row's value is already applied (steps are live) — Enter
      // just confirms and closes; on a sort row it applies that sort.
      if (focusRow === 0) onClose();
      else applySort(agents[focusRow - 1]);
      return;
    }
    if (e.key === "Escape") {
      claim();
      onClose();
      return;
    }
    // Anything else ends the popup and reaches its real target.
    onClose();
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => onKeyRef.current(e);
    const onPointerDown = (e: PointerEvent) => {
      if (cardRef.current?.contains(e.target as Node)) return;
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, [open, onClose]);

  if (!open) return null;

  const chip = (
    label: string,
    active: boolean,
    onClick: () => void,
    key?: string,
  ) => (
    <button
      key={key ?? label}
      type="button"
      onClick={onClick}
      aria-pressed={active}
      style={{
        minWidth: 0,
        height: 26,
        padding: 0,
        borderRadius: 6,
        border: active ? "1px solid var(--accent)" : "1px solid var(--border)",
        background: active
          ? "color-mix(in srgb, var(--accent) 16%, transparent)"
          : "transparent",
        color: active ? "var(--accent)" : "var(--text-dim)",
        // The ←/→ caret lives on the active chip while the width row owns the
        // popup's focus, so the eye lands where the arrows act.
        boxShadow:
          active && focusRow === 0 ? "0 0 0 2px var(--accent-glow)" : undefined,
        fontFamily: "var(--mono)",
        fontSize: 11,
        textAlign: "center",
        cursor: "pointer",
      }}
    >
      {label}
    </button>
  );

  return createPortal(
    <CardFrame
      ref={cardRef}
      role="dialog"
      aria-modal="true"
      aria-label="Grid layout quick picker"
      solid
      style={{
        position: "fixed",
        top: "22%",
        left: "50%",
        transform: "translateX(-50%)",
        width: 320,
        boxSizing: "border-box",
        padding: 12,
        display: "flex",
        flexDirection: "column",
        gap: 10,
        boxShadow: "0 18px 48px rgba(0,0,0,0.5)",
        zIndex: Z_INDEX.popover,
      }}
    >
      <div
        style={{
          fontFamily: "var(--mono)",
          fontSize: 10,
          letterSpacing: 0.6,
          textTransform: "uppercase",
          color: "var(--text-dim)",
        }}
      >
        Sessions per row
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(7, minmax(0, 1fr))",
          gap: 4,
        }}
      >
        {chip("A", currentLimit === null, () => pickLimit(null), "auto")}
        {GRID_COLUMN_OPTIONS.map((n) =>
          chip(String(n), currentLimit === n, () => pickLimit(n)),
        )}
      </div>
      {sortable && (
        <>
          <div
            style={{
              fontFamily: "var(--mono)",
              fontSize: 10,
              letterSpacing: 0.6,
              textTransform: "uppercase",
              color: "var(--text-dim)",
              marginTop: 2,
            }}
          >
            Sort sessions
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            {agents.map((agent, i) => (
              <button
                key={agent}
                type="button"
                onClick={() => applySort(agent)}
                onMouseEnter={() => setFocusRow(i + 1)}
                aria-current={focusRow === i + 1 ? "true" : undefined}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "6px 8px",
                  borderRadius: 6,
                  border: "none",
                  textAlign: "left",
                  fontSize: 12,
                  cursor: "pointer",
                  background: focusRow === i + 1 ? "var(--surface-2)" : "transparent",
                  color: focusRow === i + 1 ? "var(--text)" : "var(--text-dim)",
                }}
              >
                <span
                  aria-hidden
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    background: AGENT_META[agent].color,
                    flexShrink: 0,
                  }}
                />
                {AGENT_META[agent].label} first
              </button>
            ))}
          </div>
        </>
      )}
      <div
        style={{
          display: "flex",
          gap: 10,
          fontFamily: "var(--mono)",
          fontSize: 10,
          color: "var(--text-dim)",
          opacity: 0.8,
        }}
      >
        <span>← → width</span>
        <span>1–6 / A jump</span>
        {sortable && <span>↑↓ Enter sort</span>}
        <span>Esc close</span>
      </div>
    </CardFrame>,
    document.body,
  );
}
