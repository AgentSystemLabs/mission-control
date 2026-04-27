import { Icon } from "~/components/ui/Icon";
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

  if (!panelOpen) return null;

  return (
    <div
      style={{
        height: 320,
        minHeight: 160,
        background: "#050607",
        borderTop: "1px solid var(--border-strong)",
        display: "flex",
        flexDirection: "column",
        flexShrink: 0,
        position: "relative",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "8px 14px",
          borderBottom: "1px solid var(--border)",
          background: "var(--surface-0)",
          flexShrink: 0,
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
        <div style={{ display: "flex", gap: 6 }}>
          <button
            onClick={() => void createTerminal()}
            disabled={!project}
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
          </button>
          <button
            onClick={() => setPanelOpen(false)}
            title="Hide panel (sessions stay alive)"
            style={{
              background: "transparent",
              border: "1px solid var(--border)",
              color: "var(--text-dim)",
              padding: "3px 8px",
              borderRadius: 5,
              cursor: "pointer",
              fontFamily: "var(--mono)",
              fontSize: 10.5,
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
            }}
          >
            <Icon name="x" size={10} /> Hide
          </button>
        </div>
      </div>
      <div style={{ flex: 1, display: "flex", flexDirection: "row", overflow: "hidden" }}>
        {sessions.length === 0 ? (
          <div
            style={{
              flex: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--text-faint)",
              fontFamily: "var(--mono)",
              fontSize: 12,
            }}
          >
            {project
              ? "No terminals yet — click + New to create one."
              : "Open a project to use terminals."}
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
    </div>
  );
}
