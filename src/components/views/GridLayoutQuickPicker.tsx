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

/**
 * Keyboard-first popup opened by the session.gridLayout shortcut: press 1–6 to
 * lock that many sessions per row (A for auto), or arrow through the sort
 * options and hit Enter to group the grid by an agent. Every action applies
 * instantly and closes the popup — it's the quick-hands twin of the header's
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
  const [sortIdx, setSortIdx] = useState(0);
  const sortable = agents.length > 1;

  // Fresh highlight each open.
  useEffect(() => {
    if (open) setSortIdx(0);
  }, [open]);

  const pickLimit = (limit: number | null) => {
    saveGridColumnLimit(scopeKey, limit);
    onClose();
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
    if (sortable && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      claim();
      const delta = e.key === "ArrowDown" ? 1 : -1;
      setSortIdx((i) => (i + delta + agents.length) % agents.length);
      return;
    }
    if (sortable && e.key === "Enter") {
      claim();
      applySort(agents[sortIdx]);
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
                onMouseEnter={() => setSortIdx(i)}
                aria-current={i === sortIdx ? "true" : undefined}
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
                  background: i === sortIdx ? "var(--surface-2)" : "transparent",
                  color: i === sortIdx ? "var(--text)" : "var(--text-dim)",
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
        <span>1–6 / A set width</span>
        {sortable && <span>↑↓ Enter sort</span>}
        <span>Esc close</span>
      </div>
    </CardFrame>,
    document.body,
  );
}
