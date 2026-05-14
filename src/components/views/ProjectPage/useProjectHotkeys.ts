import { useHotkey } from "~/lib/use-hotkey";

export function useProjectHotkeys(params: {
  onNewAgentPrimary: () => void;
  setShowEdit: (updater: (v: boolean) => boolean) => void;
  showNewAgent: boolean;
  showEdit: boolean;
  confirmRemove: boolean;
  hasRunningLaunch: boolean;
  stopping: boolean;
  launching: boolean;
  runLaunch: () => Promise<void> | void;
  stopLaunch: () => Promise<void> | void;
  openFileRel: string | null;
  setFileFinderOpen: (updater: (v: boolean) => boolean) => void;
  anyBlockingDialogOpen: boolean;
  showDiffView: boolean;
  openDiffView: () => void;
  closeDiffView: () => void;
  gitAvailable: boolean;
  closePanelEnabled: boolean;
  onTerminalClose: () => void;
}) {
  const {
    onNewAgentPrimary,
    setShowEdit,
    showNewAgent,
    showEdit,
    confirmRemove,
    hasRunningLaunch,
    stopping,
    launching,
    runLaunch,
    stopLaunch,
    openFileRel,
    setFileFinderOpen,
    anyBlockingDialogOpen,
    showDiffView,
    openDiffView,
    closeDiffView,
    gitAvailable,
    closePanelEnabled,
    onTerminalClose,
  } = params;

  useHotkey("agent.new", onNewAgentPrimary, { ignoreEditable: true });

  useHotkey("project.edit", () => {
    if (showNewAgent) return;
    setShowEdit((v) => !v);
  });

  useHotkey(
    "project.runToggle",
    () => {
      if (showNewAgent || showEdit || confirmRemove) return;
      if (hasRunningLaunch) {
        if (!stopping) void stopLaunch();
      } else if (!launching) {
        void runLaunch();
      }
    },
    { ignoreEditable: true },
  );

  useHotkey(
    "file.finder",
    () => {
      if (openFileRel || showNewAgent || showEdit || confirmRemove) return;
      setFileFinderOpen((v) => !v);
    },
  );

  useHotkey(
    "git.diff",
    () => {
      if (!gitAvailable) return;
      if (anyBlockingDialogOpen) return;
      if (showDiffView) closeDiffView();
      else openDiffView();
    },
    { ignoreEditable: true },
  );

  // Capture phase so xterm.js (focused terminal) can't swallow the key first.
  useHotkey(
    "terminal.close",
    onTerminalClose,
    {
      enabled: closePanelEnabled,
      capture: true,
    },
  );
}
