import { useEffect, useState } from "react";
import { Icon } from "~/components/ui/Icon";
import { Kbd, hotkeyLabel } from "~/components/ui/Kbd";
import { AGENT_META, STATUS_META } from "~/lib/design-meta";
import { useHotkey } from "~/lib/use-hotkey";
import { useResizablePanel } from "~/lib/use-resizable-panel";
import { TerminalPane, type TerminalDescriptor } from "./TerminalPane";
import type { Project, Task } from "~/db/schema";

export type OpenTerminal = TerminalDescriptor & { project: Project; task: Task };

const MIN_WIDTH = 380;

export function TerminalPanel({
  open,
  selectedForProject,
  collapsed,
  onTogglePanel,
  onExpand,
  onClose,
  onPtyReady,
}: {
  open: OpenTerminal[];
  selectedForProject: OpenTerminal[];
  collapsed: boolean;
  onTogglePanel: () => void;
  onExpand: () => void;
  onClose: (taskId: string) => void;
  onPtyReady: (taskId: string, ptyId: string) => void;
}) {
  const [paneCollapsed, setPaneCollapsed] = useState<Set<string>>(new Set());

  useEffect(() => {
    setPaneCollapsed((prev) => {
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

  const togglePaneCollapsed = (taskId: string) => {
    setPaneCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
  };

  useHotkey("mod+l", onTogglePanel);

  const { size: width, onMouseDown: onResizeMouseDown } = useResizablePanel({
    storageKey: "mc:agentsPanelWidth",
    axis: "x",
    defaultSize: 560,
    minSize: MIN_WIDTH,
    maxSize: (vw) => vw - 320,
  });

  const focusPane = (taskId: string) => {
    const others = selectedForProject
      .filter((t) => t.task.id !== taskId && t.visible)
      .map((t) => t.task.id);
    setPaneCollapsed(new Set(others));
    onExpand();
  };

  if (collapsed) {
    if (selectedForProject.length === 0) return null;
    return (
      <div
        style={{
          width: 36,
          flexShrink: 0,
          background: "var(--surface-0)",
          borderLeft: "1px solid var(--border-strong)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 6,
          padding: "10px 0",
        }}
      >
        <button
          onClick={onExpand}
          title={`Show agents panel (${hotkeyLabel("mod+l")})`}
          style={{
            background: "transparent",
            border: 0,
            cursor: "pointer",
            color: "var(--text-dim)",
            padding: 4,
            display: "inline-flex",
          }}
        >
          <Icon name="chevron-left" size={12} />
        </button>
        <span
          style={{
            fontFamily: "var(--mono)",
            fontSize: 10,
            fontWeight: 600,
            color: "var(--text-faint)",
            fontVariantNumeric: "tabular-nums",
            marginBottom: 2,
          }}
        >
          {selectedForProject.length}
        </span>
        {selectedForProject.slice(0, 12).map((t) => {
          const meta = AGENT_META[t.task.agent];
          const statusColor = STATUS_META[t.task.status].color;
          return (
            <button
              key={t.taskId}
              onClick={() => focusPane(t.task.id)}
              title={t.task.title}
              style={{
                background: "transparent",
                border: 0,
                cursor: "pointer",
                padding: "4px 6px",
                fontFamily: "var(--mono)",
                fontSize: 15,
                lineHeight: 1,
                color: statusColor,
                borderRadius: 4,
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "var(--surface-2)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "transparent";
              }}
            >
              {meta.glyph}
            </button>
          );
        })}
      </div>
    );
  }

  if (open.length === 0) return null;
  return (
    <div
      style={{
        width,
        minWidth: MIN_WIDTH,
        background: "#050607",
        borderLeft: "1px solid var(--border-strong)",
        display: "flex",
        flexDirection: "column",
        flexShrink: 0,
        animation: "slide-right 0.2s ease-out",
        position: "relative",
      }}
    >
      <div
        onMouseDown={onResizeMouseDown}
        title="Drag to resize"
        style={{
          position: "absolute",
          left: -3,
          top: 0,
          bottom: 0,
          width: 6,
          cursor: "col-resize",
          zIndex: 10,
        }}
      />
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
            Agents
          </span>
          <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--text-faint)" }}>
            {open.length}
          </span>
        </div>
        <button
          onClick={onTogglePanel}
          title="Collapse panel (sessions stay alive)"
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
          <Icon name="chevron-right" size={10} /> Collapse
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
            collapsed={paneCollapsed.has(t.taskId)}
            onToggleCollapsed={() => togglePaneCollapsed(t.taskId)}
            onClose={() => onClose(t.taskId)}
            onPtyReady={(ptyId) => onPtyReady(t.taskId, ptyId)}
          />
        ))}
      </div>
    </div>
  );
}
