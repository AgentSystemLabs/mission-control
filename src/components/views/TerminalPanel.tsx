import { Icon } from "~/components/ui/Icon";
import { Kbd, hotkeyLabel } from "~/components/ui/Kbd";
import { useResizablePanel } from "~/lib/use-resizable-panel";
import { TerminalPane, type TerminalDescriptor } from "./TerminalPane";
import type { Project, Task } from "~/db/schema";

export type OpenTerminal = TerminalDescriptor & { project: Project; task: Task };

const MIN_WIDTH = 380;

export function TerminalPanel({
  active,
  onClose,
  onPtyReady,
}: {
  active: OpenTerminal | null;
  onClose: (taskId: string) => void;
  onPtyReady: (taskId: string, ptyId: string) => void;
}) {
  const { size: width, onMouseDown: onResizeMouseDown } = useResizablePanel({
    storageKey: "mc:agentsPanelWidth",
    axis: "x",
    defaultSize: 560,
    minSize: MIN_WIDTH,
    maxSize: (vw) => vw - 320,
  });

  if (!active) return null;
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
          gap: 8,
          padding: "10px 14px",
          borderBottom: "1px solid var(--border)",
          background: "var(--surface-0)",
          flexShrink: 0,
        }}
      >
        <Icon name="terminal" size={13} style={{ color: "var(--accent)" }} />
        <span
          style={{
            fontFamily: "var(--mono)",
            fontSize: 11.5,
            fontWeight: 600,
            letterSpacing: "0.02em",
          }}
        >
          Agent
        </span>
        <span style={{ marginLeft: "auto", color: "var(--text-faint)", fontSize: 10.5 }}>
          Close <Kbd variant="ghost">{hotkeyLabel("mod+l")}</Kbd>
        </span>
      </div>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <TerminalPane
          key={active.taskId}
          project={active.project}
          task={active.task}
          descriptor={active}
          isLast
          onClose={() => onClose(active.taskId)}
          onPtyReady={(ptyId) => onPtyReady(active.taskId, ptyId)}
        />
      </div>
    </div>
  );
}
