import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Icon } from "~/components/ui/Icon";
import { Kbd, KbdAction } from "~/components/ui/Kbd";
import { Btn } from "~/components/ui/Btn";
import { ConfirmDialog } from "~/components/ui/ConfirmDialog";
import { useResizablePanel } from "~/lib/use-resizable-panel";
import { getElectron } from "~/lib/electron";
import { api } from "~/lib/api";
import { useUserTerminals } from "~/lib/user-terminal-store";
import { DUPLICATE_ACTIVE_SESSION_EVENT } from "~/lib/design-meta";
import { queryKeys } from "~/queries";
import { TerminalPane, type TerminalDescriptor } from "./TerminalPane";
import type { Project, Task } from "~/db/schema";

export type OpenTerminal = TerminalDescriptor & { project: Project; task: Task };

const MIN_WIDTH = 380;

export function TerminalPanel({
  active,
  onClose,
  onPtyReady,
  expanded = false,
  onToggleExpanded,
}: {
  active: OpenTerminal | null;
  onClose: (taskId: string) => Promise<void> | void;
  onPtyReady: (taskId: string, ptyId: string) => void;
  expanded?: boolean;
  onToggleExpanded?: () => void;
}) {
  const queryClient = useQueryClient();
  const userTerminals = useUserTerminals();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Cmd/Ctrl+W is intercepted in the Electron main process and forwarded as
  // `app:close-intent`. The user-terminal panel claims it first when a user
  // terminal is focused; otherwise, when an agent session panel is open, we
  // open the delete-confirm dialog.
  useEffect(() => {
    const electron = getElectron();
    if (!electron || !active) return;
    return electron.onCloseIntent(() => {
      if (userTerminals.panelOpen && userTerminals.focusedId) return;
      setConfirmDelete(true);
    });
  }, [active, userTerminals.panelOpen, userTerminals.focusedId]);

  const handleDelete = async () => {
    if (!active) return;
    setDeleting(true);
    try {
      await Promise.all([onClose(active.taskId), api.deleteTask(active.taskId)]);
      await queryClient.invalidateQueries({
        queryKey: queryKeys.tasks(active.project.id),
      });
    } finally {
      setDeleting(false);
      setConfirmDelete(false);
    }
  };

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
        width: expanded ? "100%" : width,
        flex: expanded ? 1 : undefined,
        minWidth: expanded ? 0 : MIN_WIDTH,
        background: "#050607",
        borderLeft: "1px solid var(--border-strong)",
        display: "flex",
        flexDirection: "column",
        flexShrink: 0,
        animation: "slide-right 0.2s ease-out",
        position: "relative",
      }}
    >
      {!expanded && (
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
      )}
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
          Session
        </span>
        <span style={{ marginLeft: "auto", color: "var(--text-faint)", fontSize: 10.5 }}>
          Hide/show <KbdAction action="terminal.close" variant="ghost" />
        </span>
        {onToggleExpanded && (
          <Btn
            variant="ghost"
            size="sm"
            icon={expanded ? "chevron-right" : "chevron-left"}
            onClick={onToggleExpanded}
            title={expanded ? "Shrink session panel" : "Expand session panel to fill workspace"}
            aria-label={expanded ? "Shrink session panel" : "Expand session panel"}
            aria-pressed={expanded}
          >
            {expanded ? "Shrink" : "Expand"}
            <KbdAction action="terminal.expandToggle" variant="ghost" />
          </Btn>
        )}
        <Btn
          variant="ghost"
          size="sm"
          icon="copy"
          onClick={() => window.dispatchEvent(new CustomEvent(DUPLICATE_ACTIVE_SESSION_EVENT))}
          title="Spin off a new session with this session's agent and branch"
        >
          Make Similar Session <Kbd variant="ghost">⌘ ⇧ D</Kbd>
        </Btn>
        <Btn
          variant="danger"
          size="sm"
          icon="trash"
          onClick={() => setConfirmDelete(true)}
          title="Delete this session"
        >
          Delete <Kbd variant="ghost">⌘ W</Kbd>
        </Btn>
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
      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={handleDelete}
        title="Delete session?"
        confirmLabel="Delete"
        variant="danger"
        icon="trash"
        loading={deleting}
      >
        This will permanently delete the session and kill its terminal. This
        cannot be undone.
      </ConfirmDialog>
    </div>
  );
}
