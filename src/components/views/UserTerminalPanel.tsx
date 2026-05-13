import { Btn } from "~/components/ui/Btn";
import { CardFrame } from "~/components/ui/CardFrame";
import { EmptyState } from "~/components/ui/EmptyState";
import { Icon } from "~/components/ui/Icon";
import { StaticHotkeyTooltip } from "~/components/ui/Tooltip";
import { useResizablePanel } from "~/lib/use-resizable-panel";
import { STORAGE_KEYS } from "~/lib/storage-keys";
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
    renameTerminal,
    updateLaunchUrl,
    setPtyId,
  } = useUserTerminals();

  const { size: height, onMouseDown: onResizeMouseDown } = useResizablePanel({
    storageKey: STORAGE_KEYS.userTerminalsPanelHeight,
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
          <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--text-faint)" }}>
            {sessions.length}
          </span>
          {project && (
            <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--text-faint)" }}>
              · {project.name}
            </span>
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
        {sessions.length === 0 ? (
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
                title="No terminals yet"
                subtitle="Open a terminal to run commands in this project."
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
          sessions.map((s, i) => (
            <UserTerminalPane
              key={s.terminal.id}
              terminal={s.terminal}
              ptyId={s.ptyId}
              projectId={s.terminal.projectId}
              focused={focusedId === s.terminal.id}
              onFocus={() => focusTerminal(s.terminal.id)}
              onPtyReady={(ptyId) => setPtyId(s.terminal.id, ptyId)}
              onPtyExit={() => setPtyId(s.terminal.id, null)}
              onLaunchUrlDetected={updateLaunchUrl}
              onKill={() => void killTerminal(s.terminal.id)}
              onRename={(name) => void renameTerminal(s.terminal.id, name)}
              isLast={i === sessions.length - 1}
            />
          ))
        )}
      </div>
      )}
    </CardFrame>
  );
}
