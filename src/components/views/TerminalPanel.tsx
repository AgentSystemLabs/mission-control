import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { CardFrame } from "~/components/ui/CardFrame";
import { ConfirmDialog } from "~/components/ui/ConfirmDialog";
import { ARCHIVE_ACTIVE_SESSION_EVENT } from "~/lib/design-meta";
import { useResizablePanel } from "~/lib/use-resizable-panel";
import { getElectron, isElectron } from "~/lib/electron";
import { useHotkey } from "~/lib/use-hotkey";
import { isUserTerminalXtermFocused } from "~/lib/terminal-pane-helpers";
import { api } from "~/lib/api";
import { useUserTerminals } from "~/lib/user-terminal-store";
import { queryKeys } from "~/queries";
import { TerminalPane, type TerminalDescriptor } from "./TerminalPane";
import type { Project, Task } from "~/db/schema";
import { LOCAL_SCOPE_ID } from "~/shared/sandbox";
import { worktreeScopeKey } from "~/shared/worktrees";

export type OpenTerminal = TerminalDescriptor & {
  project: Project & { activeWorktreeId?: string | null; activeRuntimeScopeId?: string | null };
  task: Task;
};

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
  onPtyReady: (taskId: string, ptyId: string | null, scopeKey?: string) => void;
  expanded?: boolean;
  onToggleExpanded?: () => void;
}) {
  const queryClient = useQueryClient();
  const userTerminals = useUserTerminals();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const archivingRef = useRef(false);
  const activeScopeKey = active
    ? `${worktreeScopeKey(active.project.id, active.project.activeWorktreeId)}:${active.project.activeRuntimeScopeId ?? LOCAL_SCOPE_ID}`
    : null;

  // Archive the open session via the project page handler so repointing,
  // optimistic cache updates, and PTY teardown stay in one place.
  const archiveActive = useCallback(() => {
    if (!active || archivingRef.current) return;
    archivingRef.current = true;
    try {
      window.dispatchEvent(
        new CustomEvent(ARCHIVE_ACTIVE_SESSION_EVENT, {
          detail: { taskId: active.taskId },
        }),
      );
    } finally {
      archivingRef.current = false;
    }
  }, [active]);

  const currentActiveTask = useCallback((): Task | null => {
    if (!active) return null;
    const tasks = queryClient.getQueryData<Task[]>(
      queryKeys.tasks(
        active.project.id,
        active.project.activeWorktreeId ?? null,
        active.project.activeRuntimeScopeId ?? LOCAL_SCOPE_ID,
      ),
    );
    return tasks?.find((task) => task.id === active.taskId) ?? active.task;
  }, [active, queryClient]);

  // Permanently delete the open session. Used when it is already archived —
  // archiving again is a no-op, so Cmd/Ctrl+W escalates to a confirmed delete.
  const handleDelete = async () => {
    if (!active) return;
    if (!currentActiveTask()?.archived) {
      setConfirmDelete(false);
      return;
    }
    setDeleting(true);
    try {
      await Promise.all([onClose(active.taskId), api.deleteTask(active.taskId)]);
      await queryClient.invalidateQueries({
        queryKey: queryKeys.tasks(
          active.project.id,
          active.project.activeWorktreeId ?? null,
          active.project.activeRuntimeScopeId ?? LOCAL_SCOPE_ID,
        ),
      });
    } finally {
      setDeleting(false);
      setConfirmDelete(false);
    }
  };

  // Confirmed archive for a running session: archiving kills the live terminal
  // and stops the in-progress agent, so we warn before tearing it down.
  const confirmArchiveActive = useCallback(async () => {
    setArchiving(true);
    try {
      archiveActive();
    } finally {
      setArchiving(false);
      setConfirmArchive(false);
    }
  }, [archiveActive]);

  // Cmd/Ctrl+W: archive the open session, or — when it is already archived —
  // open the confirmed permanent-delete dialog. A running session warns first,
  // since archiving disconnects its terminal and stops the agent. In Electron
  // the keystroke is intercepted in the main process and forwarded as
  // `app:close-intent`; in the browser we bind the hotkey directly. A focused
  // user terminal claims it first.
  const handleCloseIntent = useCallback(() => {
    if (!active) return;
    if (userTerminals.panelOpen && isUserTerminalXtermFocused()) return;
    const task = currentActiveTask();
    if (task?.archived) setConfirmDelete(true);
    else if (task?.status === "running") setConfirmArchive(true);
    else void archiveActive();
  }, [active, userTerminals.panelOpen, currentActiveTask, archiveActive]);

  useEffect(() => {
    const electron = getElectron();
    if (!electron || !active) return;
    return electron.onCloseIntent(handleCloseIntent);
  }, [active, handleCloseIntent]);

  useHotkey("session.closeWindow", handleCloseIntent, {
    enabled: !isElectron() && !!active,
    capture: true,
  });

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
    storageKey: "mc:agentsPanelWidth",
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
      data-session-terminal-panel
      style={{
        width: expanded ? "100%" : width,
        flex: expanded ? 1 : undefined,
        minWidth: expanded ? 0 : MIN_WIDTH,
        display: "flex",
        flexDirection: "column",
        flexShrink: 0,
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
          key={`${active.taskId}:${activeScopeKey ?? LOCAL_SCOPE_ID}`}
          project={active.project}
          task={active.task}
          descriptor={active}
          isLast
          onHide={onHide}
          expanded={expanded}
          onToggleExpanded={onToggleExpanded}
          onPtyReady={(ptyId) => onPtyReady(active.taskId, ptyId, activeScopeKey ?? undefined)}
        />
      </div>
      <ConfirmDialog
        open={confirmArchive}
        onClose={() => setConfirmArchive(false)}
        onConfirm={confirmArchiveActive}
        title="Archive running session?"
        confirmLabel="Archive"
        variant="danger"
        icon="archive"
        loading={archiving}
      >
        This session is still running. Archiving disconnects its terminal and
        stops the in-progress agent. You can restore it later, but the current
        run won&rsquo;t resume.
      </ConfirmDialog>
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
        This will permanently delete the archived session and its terminal
        history. This cannot be undone.
      </ConfirmDialog>
    </CardFrame>
  );
}
