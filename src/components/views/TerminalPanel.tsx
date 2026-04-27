import { useEffect, useState } from "react";
import { Icon } from "~/components/ui/Icon";
import { Kbd, hotkeyLabel } from "~/components/ui/Kbd";
import { useHotkey } from "~/lib/use-hotkey";
import { TerminalPane, type TerminalDescriptor } from "./TerminalPane";
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
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  // Drop collapsed state for panes that are no longer open so newly re-opened
  // panes default back to expanded.
  useEffect(() => {
    setCollapsed((prev) => {
      const visible = new Set(open.map((o) => o.taskId));
      let changed = false;
      const next = new Set<string>();
      for (const id of prev) {
        if (visible.has(id)) next.add(id);
        else changed = true;
      }
      return changed ? next : prev;
    });
  }, [open]);

  const toggleCollapsed = (taskId: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
  };

  useHotkey("mod+l", onHideAll, { enabled: open.length > 0 });

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
          <Kbd variant="ghost">{hotkeyLabel("mod+l")}</Kbd>
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
            collapsed={collapsed.has(t.taskId)}
            onToggleCollapsed={() => toggleCollapsed(t.taskId)}
            onClose={() => onClose(t.taskId)}
            onPtyReady={(ptyId) => onPtyReady(t.taskId, ptyId)}
          />
        ))}
      </div>
    </div>
  );
}
