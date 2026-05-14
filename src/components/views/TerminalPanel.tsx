import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { CardFrame } from "~/components/ui/CardFrame";
import { ConfirmDialog } from "~/components/ui/ConfirmDialog";
import { useResizablePanel } from "~/lib/use-resizable-panel";
import { STORAGE_KEYS } from "~/lib/storage-keys";
import { getRuntime } from "~/lib/runtime";
import { api } from "~/lib/api";
import { useUserTerminals } from "~/lib/user-terminal-store";
import { queryKeys } from "~/queries";
import { TerminalPane, type TerminalDescriptor } from "./TerminalPane";
import type { Project, Task } from "~/db/schema";

export type OpenTerminal = TerminalDescriptor & { project: Project; task: Task };

const MIN_WIDTH = 380;

export function TerminalPanel({
  active,
  onClose,
  onHide,
  onPtyReady,
  expanded = false,
  onToggleExpanded,
}: {
  active: OpenTerminal | null;
  onClose: (taskId: string) => Promise<void> | void;
  onHide: () => void;
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
    const electron = getRuntime();
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

  const rootRef = useRef<HTMLElement | null>(null);
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const onFocusIn = () => setFocused(true);
    const onFocusOut = () => {
      requestAnimationFrame(() => {
        const root = rootRef.current;
        if (!root) return;
        setFocused(root.contains(document.activeElement));
      });
    };
    el.addEventListener("focusin", onFocusIn);
    el.addEventListener("focusout", onFocusOut);
    setFocused(el.contains(document.activeElement));
    return () => {
      el.removeEventListener("focusin", onFocusIn);
      el.removeEventListener("focusout", onFocusOut);
    };
  }, [active?.taskId]);

  const { size: width, onMouseDown: onResizeMouseDown } = useResizablePanel({
    storageKey: STORAGE_KEYS.agentsPanelWidth,
    axis: "x",
    defaultSize: 560,
    minSize: MIN_WIDTH,
    maxSize: (vw) => vw - 320,
  });

  if (!active) return null;
  return (
    <CardFrame
      ref={rootRef}
      focused={focused}
      style={{
        width: expanded ? "100%" : width,
        flex: expanded ? 1 : undefined,
        minWidth: expanded ? 0 : MIN_WIDTH,
        display: "flex",
        flexDirection: "column",
        flexShrink: 0,
        animation: "slide-right 0.2s ease-out",
        overflow: "visible",
      }}
    >
      {!expanded && (
        <div
          onMouseDown={onResizeMouseDown}
          title="Drag to resize"
          style={{
            position: "absolute",
            left: -9,
            top: 0,
            bottom: 0,
            width: 12,
            cursor: "col-resize",
            zIndex: 10,
          }}
        />
      )}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <TerminalPane
          key={active.taskId}
          project={active.project}
          task={active.task}
          descriptor={active}
          isLast
          onClose={() => onClose(active.taskId)}
          onHide={onHide}
          expanded={expanded}
          onToggleExpanded={onToggleExpanded}
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
    </CardFrame>
  );
}
