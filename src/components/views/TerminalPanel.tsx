import { Icon } from "~/components/ui/Icon";
import { TerminalPane, type TerminalDescriptor } from "./TerminalPane";
import { getElectron } from "~/lib/electron";
import type { Project, Task } from "~/db/schema";

export type OpenTerminal = TerminalDescriptor & { project: Project; task: Task };

export function TerminalPanel({
  open,
  onClose,
  onHideAll,
  onPtyReady,
}: {
  open: OpenTerminal[];
  onClose: (taskId: string) => void;
  onHideAll: () => void;
  onPtyReady: (taskId: string, ptyId: string) => void;
}) {
  if (open.length === 0) return null;
  return (
    <div
      style={{
        width: 560,
        minWidth: 380,
        background: "#050607",
        borderLeft: "1px solid var(--border-strong)",
        display: "flex",
        flexDirection: "column",
        flexShrink: 0,
        animation: "slide-right 0.2s ease-out",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "10px 14px",
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
            Terminals
          </span>
          <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--text-faint)" }}>
            {open.length}
          </span>
        </div>
        <button
          onClick={onHideAll}
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
          <Icon name="x" size={10} /> Hide all
        </button>
      </div>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {open.map((t, i) => (
          <TerminalPane
            key={t.taskId}
            project={t.project}
            task={t.task}
            descriptor={t}
            isLast={i === open.length - 1}
            onClose={async () => {
              const electron = getElectron();
              if (t.ptyId && electron) await electron.pty.kill(t.ptyId).catch(() => undefined);
              onClose(t.taskId);
            }}
            onPtyReady={(ptyId) => onPtyReady(t.taskId, ptyId)}
          />
        ))}
      </div>
    </div>
  );
}
