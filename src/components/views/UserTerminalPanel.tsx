import { Btn } from "~/components/ui/Btn";
import { CardFrame } from "~/components/ui/CardFrame";
import { EmptyState } from "~/components/ui/EmptyState";
import { Icon } from "~/components/ui/Icon";
import { StaticHotkeyTooltip } from "~/components/ui/Tooltip";
import { useResizablePanel } from "~/lib/use-resizable-panel";
import { useUserTerminals } from "~/lib/user-terminal-store";
import { UserTerminalPane } from "./UserTerminalPane";

const MIN_HEIGHT = 160;

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
          padding: "8px 14px",
          flexShrink: 0,
          width: "100%",
          color: "inherit",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Icon name="terminal" size={13} style={{ color: "var(--accent)" }} />
          <span
            style={{
              fontFamily: "var(--mono)",
              fontSize: 11.5,
              fontWeight: 600,
              letterSpacing: "0.02em",
            }}
          >
            Project Terminals
          </span>
          {panelOpen && sessions.length > 0 && (
            <span
              style={{
                width: 1,
                height: 14,
                background: "var(--border)",
                marginLeft: 4,
              }}
            />
          )}
          {panelOpen && sessions.length > 0 && (
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 4,
                marginLeft: 8,
                alignItems: "center",
              }}
            >
              {sessions.map((s) => {
                const hidden = hiddenIds.has(s.terminal.id);
                const active = !hidden && focusedId === s.terminal.id;
                return (
                  <button
                    key={s.terminal.id}
                    onClick={() => {
                      if (hidden) {
                        toggleHidden(s.terminal.id);
                        focusTerminal(s.terminal.id);
                      } else if (active) {
                        toggleHidden(s.terminal.id);
                      } else {
                        focusTerminal(s.terminal.id);
                      }
                    }}
                    title={hidden ? "Show terminal" : active ? "Hide terminal" : "Focus terminal"}
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
                      color: hidden ? "var(--text-faint)" : "var(--text)",
                      opacity: hidden ? 0.6 : 1,
                      cursor: "pointer",
                    }}
                  >
                    <Icon name="terminal" size={10} style={{ color: "var(--text-faint)" }} />
                    <span style={{ maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
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
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
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
      <div style={{ flex: 1, display: "flex", flexDirection: "row", overflow: "hidden", gap: 8, padding: 8 }}>
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
          visibleSessions.map((s, i) => (
            <UserTerminalPane
              key={s.terminal.id}
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
          ))
        )}
      </div>
      )}
    </CardFrame>
  );
}
