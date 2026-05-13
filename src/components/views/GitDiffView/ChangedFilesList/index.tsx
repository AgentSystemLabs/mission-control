import { useCallback, useState } from "react";
import { ConfirmDialog } from "~/components/ui/ConfirmDialog";
import { CommitPushButton } from "~/components/views/CommitPushButton";
import { useDismissableMenu } from "~/lib/use-dismissable-menu";
import { useResizablePanel } from "~/lib/use-resizable-panel";
import { STORAGE_KEYS } from "~/lib/storage-keys";
import type { GitChangedFile } from "~/server/services/git";
import { FileContextMenu } from "./FileContextMenu";
import { FileRow } from "./FileRow";
import { Empty, Section } from "./Section";
import { MIN_PANEL_WIDTH } from "./constants";

export { displayPath } from "./constants";

export type FileSelection = { path: string; staged: boolean } | null;

export function ChangedFilesList({
  staged,
  unstaged,
  selection,
  onSelect,
  onStage,
  onUnstage,
  onStageAll,
  onUnstageAll,
  onDeleteFile,
  busyPaths,
  projectId,
  mutating = false,
}: {
  staged: GitChangedFile[];
  unstaged: GitChangedFile[];
  selection: FileSelection;
  onSelect: (sel: FileSelection) => void;
  onStage: (paths: string[]) => void;
  onUnstage: (paths: string[]) => void;
  onStageAll: () => void;
  onUnstageAll: () => void;
  onDeleteFile: (path: string) => void;
  busyPaths: Set<string>;
  projectId: string;
  mutating?: boolean;
}) {
  const [shipError, setShipError] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; path: string } | null>(
    null,
  );
  const [confirmPath, setConfirmPath] = useState<string | null>(null);
  const { size: width, onMouseDown: onResizeMouseDown } = useResizablePanel({
    storageKey: STORAGE_KEYS.gitDiffChangedFilesWidth,
    axis: "x",
    defaultSize: 300,
    minSize: MIN_PANEL_WIDTH,
    maxSize: (vw) => Math.min(520, vw - 360),
    resizeEdge: "end",
  });

  const closeMenu = useCallback(() => setMenu(null), []);
  useDismissableMenu(menu !== null, closeMenu);

  const openMenu = (e: React.MouseEvent, path: string) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ x: e.clientX, y: e.clientY, path });
  };

  return (
    <div
      style={{
        flexShrink: 0,
        width,
        minWidth: MIN_PANEL_WIDTH,
        borderRight: "1px solid var(--border)",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        background: "transparent",
        position: "relative",
      }}
    >
      {shipError && (
        <div
          style={{
            padding: "6px 10px",
            borderBottom: "1px solid var(--border)",
            background: "var(--surface-1)",
            color: "var(--status-failed)",
            fontFamily: "var(--mono)",
            fontSize: 11,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            flexShrink: 0,
          }}
          title={shipError}
        >
          {shipError}
        </div>
      )}
      <div style={{ overflowY: "auto", flex: 1 }}>
        <Section
          label="Accepted Changes"
          count={staged.length}
          tone="staged"
          extra={
            <CommitPushButton
              projectId={projectId}
              label="Ship Accepted"
              title="Commit accepted changes only, then push to remote"
              autoStage={false}
              showAheadBadge={false}
              variant="primary"
              onError={(m) => setShipError(m)}
              onNotice={() => setShipError(null)}
            />
          }
        >
          {staged.length === 0 ? (
            <Empty text="No accepted files" />
          ) : (
            staged.map((f) => (
              <FileRow
                key={`s-${f.path}`}
                file={f}
                isStaged
                isSelected={
                  selection?.staged === true && selection.path === f.path
                }
                isBusy={busyPaths.has(f.path)}
                onSelect={() => onSelect({ path: f.path, staged: true })}
                onAction={() => onUnstage([f.path])}
                onContextMenu={(e) => openMenu(e, f.path)}
              />
            ))
          )}
        </Section>
        <Section
          label="Changes"
          count={unstaged.length}
          tone="unstaged"
          actionIcon="plus"
          actionTitle="Accept All"
          onAction={unstaged.length > 0 ? onStageAll : undefined}
          actionDisabled={mutating}
        >
          {unstaged.length === 0 ? (
            <Empty text="No changes" />
          ) : (
            unstaged.map((f) => (
              <FileRow
                key={`u-${f.path}`}
                file={f}
                isStaged={false}
                isSelected={
                  selection?.staged === false && selection.path === f.path
                }
                isBusy={busyPaths.has(f.path)}
                onSelect={() => onSelect({ path: f.path, staged: false })}
                onAction={() => onStage([f.path])}
                onContextMenu={(e) => openMenu(e, f.path)}
              />
            ))
          )}
        </Section>
      </div>
      <div
        onMouseDown={onResizeMouseDown}
        title="Drag to resize"
        style={{
          position: "absolute",
          top: 0,
          right: -3,
          bottom: 0,
          width: 6,
          cursor: "col-resize",
          zIndex: 10,
        }}
      />
      {menu && (
        <FileContextMenu
          x={menu.x}
          y={menu.y}
          onDelete={() => {
            const p = menu.path;
            setMenu(null);
            setConfirmPath(p);
          }}
        />
      )}
      <ConfirmDialog
        open={confirmPath !== null}
        onClose={() => setConfirmPath(null)}
        onConfirm={() => {
          if (confirmPath) onDeleteFile(confirmPath);
          setConfirmPath(null);
        }}
        title="Delete file"
        confirmLabel="Delete"
        variant="danger"
        icon="trash"
        width={440}
      >
        <div style={{ fontSize: 13, color: "var(--text)", marginBottom: 6 }}>
          Delete <code>{confirmPath}</code>?
        </div>
        <div style={{ fontSize: 12, color: "var(--text-dim)" }}>
          The file will be removed from disk. This cannot be undone.
        </div>
      </ConfirmDialog>
    </div>
  );
}
