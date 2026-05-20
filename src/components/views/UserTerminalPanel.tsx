import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { Btn } from "~/components/ui/Btn";
import { CardFrame } from "~/components/ui/CardFrame";
import { EmptyState } from "~/components/ui/EmptyState";
import { Icon } from "~/components/ui/Icon";
import { StaticHotkeyTooltip } from "~/components/ui/Tooltip";
import { useResizablePanel } from "~/lib/use-resizable-panel";
import { useUserTerminals } from "~/lib/user-terminal-store";
import { UserTerminalPane } from "./UserTerminalPane";

const MIN_HEIGHT = 160;
const MIN_PANE_WIDTH = 200;
const PANE_WEIGHTS_STORAGE_KEY = "mc:userTerminalPaneWeights";

type PaneWeights = Record<string, number>;

function readStoredWeights(): PaneWeights {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(PANE_WEIGHTS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    const out: PaneWeights = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === "number" && Number.isFinite(v) && v > 0) out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

export function UserTerminalPanel() {
  const {
    project,
    panelOpen,
    setPanelOpen,
    sessions,
    focusedId,
    focusTerminal,
    createTerminal,
    killTerminal,
    hiddenIds,
    toggleHidden,
    renameTerminal,
    updateLaunchUrl,
    setPtyId,
  } = useUserTerminals();

  const visibleSessions = sessions.filter((s) => !hiddenIds.has(s.terminal.id));

  const { size: height, onMouseDown: onResizeMouseDown } = useResizablePanel({
    storageKey: "mc:userTerminalsPanelHeight",
    axis: "y",
    defaultSize: 320,
    minSize: MIN_HEIGHT,
    maxSize: (vh) => vh - 160,
  });

  const paneRowRef = useRef<HTMLDivElement | null>(null);
  const [paneWeights, setPaneWeights] = useState<PaneWeights>(() => readStoredWeights());

  useEffect(() => {
    try {
      window.localStorage.setItem(
        PANE_WEIGHTS_STORAGE_KEY,
        JSON.stringify(paneWeights),
      );
    } catch {
      // ignore quota / privacy-mode errors
    }
  }, [paneWeights]);

  const onTerminalTabClick = useCallback(
    (id: string, hidden: boolean) => {
      if (!panelOpen) {
        if (hidden) toggleHidden(id);
        focusTerminal(id);
        setPanelOpen(true);
        return;
      }

      if (hidden) {
        toggleHidden(id);
        focusTerminal(id);
      } else {
        toggleHidden(id);
      }
    },
    [focusTerminal, panelOpen, setPanelOpen, toggleHidden],
  );

  const onSplitterDrag = useCallback(
    (leftId: string, rightId: string, event: React.MouseEvent) => {
      event.preventDefault();
      const row = paneRowRef.current;
      if (!row) return;
      const containerWidth = row.getBoundingClientRect().width;
      if (containerWidth <= 0) return;

      const startX = event.clientX;
      // Snapshot weights so the math is stable across the drag.
      const startLeft = paneWeights[leftId] ?? 1;
      const startRight = paneWeights[rightId] ?? 1;
      const pairSum = startLeft + startRight;

      // Read the two panes' actual pixel widths at drag start so the math
      // works whether or not the user has resized this pair before.
      const leftEl = row.querySelector<HTMLElement>(`[data-pane-id="${CSS.escape(leftId)}"]`);
      const rightEl = row.querySelector<HTMLElement>(`[data-pane-id="${CSS.escape(rightId)}"]`);
      if (!leftEl || !rightEl) return;
      const startLeftWidth = leftEl.getBoundingClientRect().width;
      const startRightWidth = rightEl.getBoundingClientRect().width;
      const pairWidth = startLeftWidth + startRightWidth;
      if (pairWidth <= 0) return;

      const onMove = (ev: MouseEvent) => {
        const dx = ev.clientX - startX;
        const maxLeft = pairWidth - MIN_PANE_WIDTH;
        const nextLeftWidth = Math.max(
          MIN_PANE_WIDTH,
          Math.min(maxLeft, startLeftWidth + dx),
        );
        const nextRightWidth = pairWidth - nextLeftWidth;
        const nextLeftWeight = (nextLeftWidth / pairWidth) * pairSum;
        const nextRightWeight = (nextRightWidth / pairWidth) * pairSum;
        setPaneWeights((prev) => ({
          ...prev,
          [leftId]: nextLeftWeight,
          [rightId]: nextRightWeight,
        }));
      };
      const onUp = () => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    },
    [paneWeights],
  );

  if (!project) return null;

  return (
    <CardFrame
      frame="slanted"
      style={{
        width: "100%",
        height: panelOpen ? height : "auto",
        minHeight: panelOpen ? MIN_HEIGHT : 0,
        display: "flex",
        flexDirection: "column",
        flexShrink: 0,
        overflow: "visible",
      }}
    >
      {panelOpen && (
        <div
          onMouseDown={onResizeMouseDown}
          title="Drag to resize"
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: -13,
            height: 16,
            cursor: "row-resize",
            zIndex: 10,
          }}
        />
      )}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          padding: "8px 14px",
          flexShrink: 0,
          width: "100%",
          color: "inherit",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            flex: "1 1 auto",
            minWidth: 0,
          }}
        >
          <Icon name="terminal" size={13} style={{ color: "var(--accent)" }} />
          <span
            style={{
              fontFamily: "var(--mono)",
              fontSize: 11.5,
              fontWeight: 600,
              letterSpacing: "0.02em",
              flex: "0 0 auto",
            }}
          >
            Project Terminals
          </span>
          {sessions.length > 0 && (
            <span
              style={{
                width: 1,
                height: 14,
                background: "var(--border)",
                marginLeft: 4,
                flex: "0 0 auto",
              }}
            />
          )}
          {sessions.length > 0 && (
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 4,
                marginLeft: 8,
                alignItems: "center",
                flex: "1 1 auto",
                minWidth: 0,
              }}
            >
              {sessions.map((s) => {
                const hidden = hiddenIds.has(s.terminal.id);
                const focused = focusedId === s.terminal.id;
                const active = panelOpen ? !hidden && focused : focused;
                const dimmed = panelOpen && hidden;
                return (
                  <button
                    key={s.terminal.id}
                    onClick={() => onTerminalTabClick(s.terminal.id, hidden)}
                    title={
                      panelOpen
                        ? hidden
                          ? "Show terminal"
                          : "Hide terminal"
                        : "Open terminal"
                    }
                    aria-label={
                      panelOpen
                        ? hidden
                          ? `Show terminal ${s.terminal.name}`
                          : `Hide terminal ${s.terminal.name}`
                        : `Open terminal ${s.terminal.name}`
                    }
                    aria-pressed={panelOpen ? !hidden : undefined}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                      padding: "3px 9px",
                      background: active ? "var(--surface-1)" : "transparent",
                      border: `1px solid ${active ? "var(--accent)" : "var(--border)"}`,
                      borderRadius: 4,
                      fontFamily: "var(--mono)",
                      fontSize: 11,
                      color: dimmed ? "var(--text-faint)" : "var(--text)",
                      opacity: dimmed ? 0.6 : 1,
                      cursor: "pointer",
                      maxWidth: 154,
                      minWidth: 0,
                    }}
                  >
                    <Icon name="terminal" size={10} style={{ color: "var(--text-faint)" }} />
                    <span
                      style={{
                        maxWidth: 120,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {s.terminal.name}
                    </span>
                    {s.ptyId && (
                      <span
                        style={{
                          width: 6,
                          height: 6,
                          borderRadius: "50%",
                          background: "var(--accent)",
                        }}
                      />
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center", flex: "0 0 auto" }}>
          <StaticHotkeyTooltip hotkey="⌘T" label="New terminal">
            <Btn
              variant="ghost"
              size="sm"
              icon="plus"
              disabled={!project}
              onClick={() => {
                if (project) void createTerminal();
              }}
            >
              New
            </Btn>
          </StaticHotkeyTooltip>
          <StaticHotkeyTooltip
            hotkey="⌃`"
            label={panelOpen ? "Collapse panel" : "Expand panel"}
          >
            <Btn
              variant="ghost"
              size="sm"
              icon={panelOpen ? "chevron-down" : "chevron-up"}
              aria-label={panelOpen ? "Collapse panel" : "Expand panel"}
              onClick={() => setPanelOpen(!panelOpen)}
            />
          </StaticHotkeyTooltip>
        </div>
      </div>
      {panelOpen && (
      <div
        ref={paneRowRef}
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "row",
          overflow: "hidden",
          // gap removed when we have splitters between panes — the splitter
          // provides its own visual spacing/hit area.
          gap: visibleSessions.length > 1 ? 0 : 8,
          padding: 8,
        }}
      >
        {visibleSessions.length === 0 ? (
          <div
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--text-dim)",
              fontFamily: "var(--mono)",
              fontSize: 12,
            }}
          >
            {project ? (
              <EmptyState
                icon="terminal"
                title={sessions.length === 0 ? "No terminals yet" : "All terminals hidden"}
                subtitle={
                  sessions.length === 0
                    ? "Open a terminal to run commands in this project."
                    : "Click a tab above to bring a terminal back into view."
                }
                action={
                  <StaticHotkeyTooltip hotkey="⌘T">
                    <Btn
                      variant="ghost"
                      size="sm"
                      icon="plus"
                      onClick={() => void createTerminal()}
                    >
                      New terminal
                    </Btn>
                  </StaticHotkeyTooltip>
                }
              />
            ) : (
              "Open a project to use terminals."
            )}
          </div>
        ) : (
          visibleSessions.map((s, i) => {
            const onlyVisible = visibleSessions.length === 1;
            const weight = paneWeights[s.terminal.id] ?? 1;
            const prev = visibleSessions[i - 1];
            return (
              <Fragment key={s.terminal.id}>
                {prev && (
                  <PaneSplitter
                    onMouseDown={(e) => onSplitterDrag(prev.terminal.id, s.terminal.id, e)}
                  />
                )}
                <div
                  data-pane-id={s.terminal.id}
                  style={{
                    flex: onlyVisible ? "1 1 100%" : `${weight} 1 0`,
                    width: onlyVisible ? "100%" : undefined,
                    minWidth: MIN_PANE_WIDTH,
                    display: "flex",
                    flexDirection: "column",
                    minHeight: 0,
                    overflow: "hidden",
                  }}
                >
                  <UserTerminalPane
                    terminal={s.terminal}
                    ptyId={s.ptyId}
                    cwd={s.terminal.cwd || project?.path || ""}
                    focused={focusedId === s.terminal.id}
                    onFocus={() => focusTerminal(s.terminal.id)}
                    onPtyReady={(ptyId) => setPtyId(s.terminal.id, ptyId)}
                    onPtyExit={() => setPtyId(s.terminal.id, null)}
                    onLaunchUrlDetected={updateLaunchUrl}
                    onHide={() => toggleHidden(s.terminal.id)}
                    onDelete={() => void killTerminal(s.terminal.id)}
                    onRename={(name) => void renameTerminal(s.terminal.id, name)}
                    isLast={i === visibleSessions.length - 1}
                  />
                </div>
              </Fragment>
            );
          })
        )}
      </div>
      )}
    </CardFrame>
  );
}

function PaneSplitter({
  onMouseDown,
}: {
  onMouseDown: (e: React.MouseEvent) => void;
}) {
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      title="Drag to resize"
      onMouseDown={onMouseDown}
      style={{
        flex: "0 0 8px",
        alignSelf: "stretch",
        cursor: "col-resize",
        position: "relative",
        background: "transparent",
      }}
    >
      <div
        aria-hidden
        style={{
          position: "absolute",
          left: "50%",
          top: 0,
          bottom: 0,
          width: 1,
          background: "var(--border)",
          transform: "translateX(-0.5px)",
        }}
      />
    </div>
  );
}
