import { Btn } from "~/components/ui/Btn";
import { Icon } from "~/components/ui/Icon";
import { Kbd } from "~/components/ui/Kbd";
import { useUserTerminals } from "~/lib/user-terminal-store";
import { UserTerminalPane } from "./UserTerminalPane";

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
    setPtyId,
  } = useUserTerminals();

  if (!project) return null;

  return (
    <div
      style={{
        height: panelOpen ? 320 : "auto",
        minHeight: panelOpen ? 160 : 0,
        background: "#050607",
        borderTop: "1px solid var(--border-strong)",
        display: "flex",
        flexDirection: "column",
        flexShrink: 0,
        position: "relative",
      }}
    >
      <button
        type="button"
        onClick={() => setPanelOpen(!panelOpen)}
        title={panelOpen ? "Collapse panel" : "Expand panel"}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "8px 14px",
          borderBottom: panelOpen ? "1px solid var(--border)" : "none",
          background: "var(--surface-0)",
          flexShrink: 0,
          width: "100%",
          textAlign: "left",
          border: 0,
          cursor: "pointer",
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
          <Kbd variant="ghost">⌃`</Kbd>
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation();
              if (project) void createTerminal();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                e.stopPropagation();
                if (project) void createTerminal();
              }
            }}
            aria-disabled={!project}
            title={project ? "New terminal (⌘T)" : "Open a project first"}
            style={{
              background: "transparent",
              border: "1px solid var(--border)",
              color: project ? "var(--text-dim)" : "var(--text-faint)",
              padding: "3px 8px",
              borderRadius: 5,
              cursor: project ? "pointer" : "not-allowed",
              fontFamily: "var(--mono)",
              fontSize: 10.5,
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
            }}
          >
            <Icon name="plus" size={10} /> New
            <span style={{ color: "var(--text-faint)", marginLeft: 4 }}>⌘T</span>
          </span>
          <Icon
            name="chevron-down"
            size={12}
            style={{
              color: "var(--text-dim)",
              transform: panelOpen ? "rotate(0deg)" : "rotate(180deg)",
              transition: "transform 0.15s",
            }}
          />
        </div>
      </button>
      {panelOpen && (
      <div style={{ flex: 1, display: "flex", flexDirection: "row", overflow: "hidden" }}>
        {sessions.length === 0 ? (
          <div
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 12,
              color: "var(--text-faint)",
              fontFamily: "var(--mono)",
              fontSize: 12,
            }}
          >
            {project ? (
              <>
                <div>No terminals yet.</div>
                <Btn
                  variant="ghost"
                  size="sm"
                  icon="plus"
                  onClick={() => void createTerminal()}
                  title="New terminal (⌘T)"
                >
                  New terminal
                  <Kbd variant="ghost">⌘T</Kbd>
                </Btn>
              </>
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
              cwd={s.terminal.cwd || project?.path || ""}
              focused={focusedId === s.terminal.id}
              onFocus={() => focusTerminal(s.terminal.id)}
              onPtyReady={(ptyId) => setPtyId(s.terminal.id, ptyId)}
              onKill={() => void killTerminal(s.terminal.id)}
              onRename={(name) => void renameTerminal(s.terminal.id, name)}
              isLast={i === sessions.length - 1}
            />
          ))
        )}
      </div>
      )}
    </div>
  );
}
