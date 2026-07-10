import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Btn } from "~/components/ui/Btn";
import { CardFrame } from "~/components/ui/CardFrame";
import { DropdownMenuItem, DropdownMenuSeparator } from "~/components/ui/DropdownMenuItem";
import { Icon } from "~/components/ui/Icon";
import { HotkeyTooltip } from "~/components/ui/Tooltip";
import { AGENT_META } from "~/lib/design-meta";
import {
  GRID_COLUMN_OPTIONS,
  GRID_PREFS_EVENT,
  loadGridColumnLimit,
  requestGridSort,
  saveGridColumnLimit,
  type GridPrefsEventDetail,
} from "~/lib/grid-layout-prefs";
import { useTerminals } from "~/lib/terminal-store";
import { Z_INDEX } from "~/lib/z-index";
import type { TaskAgent } from "~/shared/domain";
import { scopeKeyFor } from "./SessionGrid";

// Fixed menu width: the width chips lay out as one 7-column row (Auto + 1–6),
// and the viewport clamp in updateMenuRect needs the real width to be exact.
const MENU_WIDTH = 288;

/** Small section caption inside the dropdown ("Sessions per row", "Sort"). */
function MenuLabel({ children }: { children: string }) {
  return (
    <div
      style={{
        padding: "8px 12px 4px",
        fontFamily: "var(--mono)",
        fontSize: 10,
        letterSpacing: 0.6,
        textTransform: "uppercase",
        color: "var(--text-dim)",
      }}
    >
      {children}
    </div>
  );
}

/**
 * Grid-view layout control in the project header: pick how many sessions a row
 * holds (a per-scope lock — new sessions flow into the next row with space, or
 * a fresh one, once a row is full; picking a width also reflows the current
 * cells), and one-shot "sort by agent" actions that group the grid's cells with
 * a chosen agent's sessions first, keeping the authored row shape.
 *
 * Talks to the mounted SessionGrid over the grid-layout-prefs window events —
 * the two components share a scope key, not React state.
 */
export function GridLayoutButton({ scopeKey }: { scopeKey: string }) {
  const { sessions } = useTerminals();
  const [open, setOpen] = useState(false);
  const [menuRect, setMenuRect] = useState<{ top: number; left: number } | null>(null);
  const anchorRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLElement>(null);
  const [columnLimit, setColumnLimit] = useState<number | null>(() =>
    loadGridColumnLimit(scopeKey),
  );

  // Re-read the lock when the scope changes and when anything saves it (the
  // save always fires GRID_PREFS_EVENT, including our own chip clicks).
  useEffect(() => {
    setColumnLimit(loadGridColumnLimit(scopeKey));
    const onPrefs = (e: Event) => {
      if ((e as CustomEvent<GridPrefsEventDetail>).detail.scopeKey !== scopeKey) return;
      setColumnLimit(loadGridColumnLimit(scopeKey));
    };
    window.addEventListener(GRID_PREFS_EVENT, onPrefs);
    return () => window.removeEventListener(GRID_PREFS_EVENT, onPrefs);
  }, [scopeKey]);

  const updateMenuRect = useCallback(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    // The button sits on the left side of the header (beside the scope
    // toggle), so the menu hangs from the button's LEFT edge — right-aligning
    // (the pattern the right-side header menus use) would push it away from
    // its trigger. Clamped so a narrow window never clips it.
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - MENU_WIDTH - 8));
    setMenuRect({ top: rect.bottom + 6, left });
  }, []);

  useLayoutEffect(() => {
    if (!open) {
      setMenuRect(null);
      return;
    }
    updateMenuRect();
    window.addEventListener("resize", updateMenuRect);
    window.addEventListener("scroll", updateMenuRect, true);
    return () => {
      window.removeEventListener("resize", updateMenuRect);
      window.removeEventListener("scroll", updateMenuRect, true);
    };
  }, [open, updateMenuRect]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (anchorRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Agents with at least one open session in this scope, in registry order —
  // the sort actions offered. Sorting a single-agent grid is a no-op, so the
  // section only shows once two kinds of sessions coexist.
  const agentsPresent = useMemo(() => {
    const present = new Set(
      sessions.filter((s) => scopeKeyFor(s) === scopeKey).map((s) => s.task.agent),
    );
    return (Object.keys(AGENT_META) as TaskAgent[]).filter((a) => present.has(a));
  }, [sessions, scopeKey]);

  const pickLimit = (limit: number | null) => {
    // Persisting fires GRID_PREFS_EVENT; the grid reflows and this button's
    // listener refreshes the checked chip. The menu stays open — the chips act
    // like a radio group and the reflow previews live behind the menu.
    saveGridColumnLimit(scopeKey, limit);
  };

  const sortBy = (agent: TaskAgent) => {
    setOpen(false);
    requestGridSort(scopeKey, agent);
  };

  const chipBase = {
    minWidth: 0,
    height: 24,
    padding: 0,
    borderRadius: 6,
    border: "1px solid var(--border)",
    background: "transparent",
    color: "var(--text-dim)",
    fontFamily: "var(--mono)",
    fontSize: 11,
    textAlign: "center",
    cursor: "pointer",
  } as const;

  return (
    <div ref={anchorRef} style={{ display: "inline-flex", alignItems: "center" }}>
      <HotkeyTooltip
        action="session.gridLayout"
        label={
          columnLimit === null
            ? "Grid layout"
            : `Grid layout — ${columnLimit} per row`
        }
      >
        <Btn
          variant="ghost"
          onClick={() => setOpen((v) => !v)}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label="Grid layout"
          style={{
            width: 40,
            minWidth: 40,
            paddingInline: 0,
            background: open ? "var(--surface-2)" : undefined,
            color: open || columnLimit !== null ? "var(--text)" : undefined,
          }}
        >
          <Icon name="grid" size={15} />
        </Btn>
      </HotkeyTooltip>
      {open &&
        menuRect &&
        createPortal(
          <CardFrame
            ref={menuRef}
            role="menu"
            aria-label="Grid layout"
            solid
            className="mc-project-actions-menu"
            style={{
              position: "fixed",
              top: menuRect.top,
              left: menuRect.left,
              width: MENU_WIDTH,
              boxSizing: "border-box",
              boxShadow: "0 14px 32px rgba(0,0,0,0.42)",
              zIndex: Z_INDEX.popover,
            }}
          >
            <MenuLabel>Sessions per row</MenuLabel>
            <div
              role="radiogroup"
              aria-label="Sessions per row"
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(7, minmax(0, 1fr))",
                gap: 4,
                padding: "2px 12px 8px",
              }}
            >
              <button
                type="button"
                role="radio"
                aria-checked={columnLimit === null}
                onClick={() => pickLimit(null)}
                style={{
                  ...chipBase,
                  ...(columnLimit === null
                    ? {
                        borderColor: "var(--accent)",
                        color: "var(--accent)",
                        background: "var(--accent-faint, transparent)",
                      }
                    : null),
                }}
              >
                Auto
              </button>
              {GRID_COLUMN_OPTIONS.map((n) => (
                <button
                  key={n}
                  type="button"
                  role="radio"
                  aria-checked={columnLimit === n}
                  onClick={() => pickLimit(n)}
                  title={`${n} session${n === 1 ? "" : "s"} per row`}
                  style={{
                    ...chipBase,
                    ...(columnLimit === n
                      ? {
                          borderColor: "var(--accent)",
                          color: "var(--accent)",
                          background: "var(--accent-faint, transparent)",
                        }
                      : null),
                  }}
                >
                  {n}
                </button>
              ))}
            </div>
            <div
              style={{
                padding: "0 12px 8px",
                fontSize: 11,
                color: "var(--text-dim)",
                lineHeight: 1.4,
              }}
            >
              {columnLimit === null
                ? "Rows grow freely; new sessions join the current row."
                : `Full rows overflow into the next row with space, or a new one.`}
            </div>
            {agentsPresent.length > 1 && (
              <>
                <DropdownMenuSeparator />
                <MenuLabel>Sort sessions</MenuLabel>
                {agentsPresent.map((agent) => (
                  <DropdownMenuItem
                    key={agent}
                    leading={
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
                    }
                    onClick={() => sortBy(agent)}
                    title={`Group the grid with ${AGENT_META[agent].label} sessions first`}
                  >
                    {AGENT_META[agent].label} first
                  </DropdownMenuItem>
                ))}
              </>
            )}
          </CardFrame>,
          document.body,
        )}
    </div>
  );
}
