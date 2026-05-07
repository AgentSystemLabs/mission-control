import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Btn } from "~/components/ui/Btn";
import { Icon } from "~/components/ui/Icon";
import { Kbd } from "~/components/ui/Kbd";
import { useHotkey } from "~/lib/use-hotkey";
import {
  useDeleteProjectFile,
  useGitDiff,
  useGitStatus,
  useStageFiles,
  useUnstageFiles,
} from "~/queries/git";
import {
  ChangedFilesList,
  displayPath,
  type FileSelection,
} from "./ChangedFilesList";
import { DiffPane } from "./DiffPane";

export function GitDiffView({
  projectId,
  projectPath,
  onBack,
}: {
  projectId: string;
  projectPath: string;
  onBack: () => void;
}) {
  const { data: status, isLoading, error } = useGitStatus(projectId);
  const stageM = useStageFiles(projectId);
  const unstageM = useUnstageFiles(projectId);
  const deleteM = useDeleteProjectFile(projectId);

  const [selection, setSelection] = useState<FileSelection>(null);
  const stagedFiles = useMemo(() => status?.staged ?? [], [status]);
  const unstagedFiles = useMemo(() => status?.unstaged ?? [], [status]);

  // Keep selection valid when the file list shifts (stage/unstage).
  // - If selection moved to the other section, follow it.
  // - If it disappeared entirely (e.g. committed), pick the first available.
  const lastSelectedRef = useRef<FileSelection>(null);
  useEffect(() => {
    if (!status) return;
    if (selection) {
      const inStaged = stagedFiles.some((f) => f.path === selection.path);
      const inUnstaged = unstagedFiles.some((f) => f.path === selection.path);
      if (selection.staged && inStaged) return;
      if (!selection.staged && inUnstaged) return;
      if (inStaged) {
        setSelection({ path: selection.path, staged: true });
        return;
      }
      if (inUnstaged) {
        setSelection({ path: selection.path, staged: false });
        return;
      }
    }
    const fallback =
      stagedFiles[0] ?? unstagedFiles[0] ?? null;
    if (fallback) {
      setSelection({
        path: fallback.path,
        staged: stagedFiles.includes(fallback),
      });
    } else {
      setSelection(null);
    }
  }, [status, stagedFiles, unstagedFiles]);

  useEffect(() => {
    lastSelectedRef.current = selection;
  }, [selection]);

  useHotkey("escape", onBack, { preventDefault: false });

  const onStageAll = useCallback(() => {
    if (unstagedFiles.length === 0) return;
    stageM.mutate(unstagedFiles.map((f) => f.path));
  }, [unstagedFiles, stageM]);

  const onUnstageAll = useCallback(() => {
    if (stagedFiles.length === 0) return;
    unstageM.mutate(stagedFiles.map((f) => f.path));
  }, [stagedFiles, unstageM]);

  const busyPaths = useMemo(() => {
    const s = new Set<string>();
    if (stageM.isPending && stageM.variables) {
      for (const p of stageM.variables) s.add(p);
    }
    if (unstageM.isPending && unstageM.variables) {
      for (const p of unstageM.variables) s.add(p);
    }
    return s;
  }, [stageM.isPending, stageM.variables, unstageM.isPending, unstageM.variables]);

  const diffQuery = useGitDiff(
    projectId,
    selection?.path ?? null,
    selection?.staged ?? false,
  );
  const selectedDisplay = selection ? displayPath(selection.path) : null;

  return (
    <div
      data-navigation-swipe-blocker
      style={{
        position: "fixed",
        top: "var(--mc-workspace-top, 0px)",
        left: "var(--mc-workspace-left, 0px)",
        right: 0,
        bottom: 0,
        zIndex: 200,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        background: "var(--surface-0)",
        boxShadow: "0 0 0 1px var(--border-strong)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          flexWrap: "wrap",
          padding: "10px 16px",
          borderBottom: "1px solid var(--border)",
          background: "var(--surface-1)",
        }}
      >
        <Btn
          variant="ghost"
          size="sm"
          icon="chevron-left"
          onClick={onBack}
          title="Back to project"
          aria-label="Back to project"
        >
          Back <Kbd variant="inline">Esc</Kbd>
        </Btn>
        <div
          style={{
            flex: "1 1 180px",
            minWidth: 0,
            color: "var(--text-faint)",
            fontFamily: "var(--mono)",
            fontSize: 11,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            textAlign: "right",
          }}
          title={projectPath}
        >
          {projectPath}
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            color: "var(--text-dim)",
            fontFamily: "var(--mono)",
            fontSize: 12,
            minWidth: 0,
            flexShrink: 1,
          }}
        >
          <Icon name="git-branch" size={12} />
          <span
            title={status?.branch}
            style={{
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              maxWidth: 220,
            }}
          >
            {status?.branch ?? "…"}
          </span>
        </div>
      </div>

      {error ? (
        <div
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--status-failed)",
            fontFamily: "var(--mono)",
            fontSize: 12,
            padding: 24,
            textAlign: "center",
          }}
        >
          {(error as Error).message}
        </div>
      ) : (
        <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
          <ChangedFilesList
            staged={stagedFiles}
            unstaged={unstagedFiles}
            selection={selection}
            onSelect={setSelection}
            onStage={(paths) => stageM.mutate(paths)}
            onUnstage={(paths) => unstageM.mutate(paths)}
            onStageAll={onStageAll}
            onUnstageAll={onUnstageAll}
            onDeleteFile={(p) => deleteM.mutate(p)}
            busyPaths={busyPaths}
            projectId={projectId}
          />
          <div
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
              minWidth: 0,
            }}
          >
            <div
              style={{
                padding: "6px 12px",
                fontFamily: "var(--mono)",
                fontSize: 11,
                color: "var(--text-dim)",
                borderBottom: "1px solid var(--border)",
                background: "var(--surface-1)",
                display: "flex",
                alignItems: "baseline",
                gap: 6,
                whiteSpace: "nowrap",
                overflow: "hidden",
                minHeight: 24,
              }}
              title={selection?.path}
            >
              {selection && selectedDisplay ? (
                <>
                  <span
                    style={{
                      minWidth: 0,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      flex: "0 1 auto",
                      color: "var(--text)",
                    }}
                  >
                    {selectedDisplay.basename}
                  </span>
                  {selectedDisplay.dir && (
                    <span
                      style={{
                        minWidth: 0,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        flex: "1 1 auto",
                        color: "var(--text-faint)",
                      }}
                    >
                      &lt;{selectedDisplay.dir}&gt;
                    </span>
                  )}
                  {selection.staged && (
                    <span
                      style={{
                        flexShrink: 0,
                        color: "var(--text-faint)",
                      }}
                    >
                      · accepted
                    </span>
                  )}
                </>
              ) : isLoading ? (
                "Loading…"
              ) : (
                "No file selected"
              )}
            </div>
            <DiffPane
              diff={diffQuery.data}
              loading={diffQuery.isLoading}
              error={diffQuery.error ? (diffQuery.error as Error).message : null}
              filePath={selection?.path ?? null}
            />
          </div>
        </div>
      )}
    </div>
  );
}
