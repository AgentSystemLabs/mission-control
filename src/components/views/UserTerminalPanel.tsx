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
    pendingKillId,
    confirmKill,
    cancelKill,
  } = useUserTerminals();

  const pending = pendingKillId
    ? sessions.find((s) => s.terminal.id === pendingKillId)?.terminal ?? null
    : null;

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
      {pending && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: "rgba(0,0,0,0.55)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 10,
          }}
          onClick={cancelKill}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "var(--surface-1)",
              border: "1px solid var(--border-strong)",
              borderRadius: 8,
              padding: "16px 20px",
              minWidth: 320,
              maxWidth: 440,
              fontFamily: "var(--sans)",
              boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
            }}
          >
            <div
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: "var(--text)",
                marginBottom: 6,
              }}
            >
              Close terminal &ldquo;{pending.name}&rdquo;?
            </div>
            <div
              style={{
                fontSize: 12,
                color: "var(--text-dim)",
                marginBottom: 14,
              }}
            >
              The shell process will be killed. Press{" "}
              <Kbd variant="inline">Enter</Kbd>{" "}
              to confirm,{" "}
              <Kbd variant="inline">Esc</Kbd>{" "}
              to cancel.
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button
                onClick={cancelKill}
                style={{
                  background: "transparent",
                  border: "1px solid var(--border)",
                  color: "var(--text-dim)",
                  padding: "5px 12px",
                  borderRadius: 5,
                  cursor: "pointer",
                  fontFamily: "var(--mono)",
                  fontSize: 11,
                }}
              >
                Cancel
              </button>
              <button
                onClick={confirmKill}
                style={{
                  background: "var(--status-failed, #d05a5a)",
                  border: "1px solid var(--status-failed, #d05a5a)",
                  color: "#0a0b0d",
                  padding: "5px 12px",
                  borderRadius: 5,
                  cursor: "pointer",
                  fontFamily: "var(--mono)",
                  fontSize: 11,
                  fontWeight: 600,
                }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
