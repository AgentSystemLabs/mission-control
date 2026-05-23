import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Icon } from "~/components/ui/Icon";
import { ConfirmDialog } from "~/components/ui/ConfirmDialog";
import { CommitPushButton } from "~/components/views/CommitPushButton";
import { useDismissableMenu } from "~/lib/use-dismissable-menu";
import { useResizablePanel } from "~/lib/use-resizable-panel";
import { api, type AppSettings } from "~/lib/api";
import {
  GIT_DIFF_CHANGED_FILES_WIDTH_STORAGE_KEY,
  readCachedGitDiffChangedFilesView,
  writeCachedGitDiffChangedFilesView,
} from "~/lib/ui-preference-cache";
import { queryKeys, useSettings } from "~/queries";
import type { GitChangedFile, GitFileStatus } from "~/server/services/git";
import {
  DEFAULT_GIT_DIFF_CHANGED_FILES_VIEW,
  DEFAULT_GIT_DIFF_CHANGED_FILES_WIDTH,
  GIT_DIFF_CHANGED_FILES_WIDTH_MIN,
  normalizeGitDiffChangedFilesWidth,
  type GitDiffChangedFilesView,
} from "~/shared/ui-preferences";

const ADD = "#6cd07e";
const MOD = "#e8b94a";
const DEL = "#e06b6b";

const STATUS_META: Record<GitFileStatus, { letter: string; color: string }> = {
  added: { letter: "A", color: ADD },
  modified: { letter: "M", color: MOD },
  deleted: { letter: "D", color: DEL },
  renamed: { letter: "R", color: MOD },
  copied: { letter: "C", color: MOD },
  untracked: { letter: "U", color: ADD },
  unmerged: { letter: "!", color: DEL },
  "type-changed": { letter: "T", color: MOD },
};

export type FileSelection = { path: string; staged: boolean } | null;
type FileListView = GitDiffChangedFilesView;
type MutableTreeDir = {
  name: string;
  path: string;
  fileCount: number;
  dirs: Map<string, MutableTreeDir>;
  files: GitChangedFile[];
};

export function ChangedFilesList({
  staged,
  unstaged,
  selection,
  onSelect,
  onStage,
  onUnstage,
  onStageAll,
  onUnstageAll: _onUnstageAll,
  onDeleteFile,
  busyPaths,
  projectId,
  worktreeId,
  enabled = true,
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
  worktreeId?: string | null;
  enabled?: boolean;
}) {
  const queryClient = useQueryClient();
  const { data: settings } = useSettings();
  const settingsLoaded = settings !== undefined;
  const storedViewMode = settings?.gitDiffChangedFilesView ?? null;
  const storedWidth = settings?.gitDiffChangedFilesWidth ?? null;
  const [shipError, setShipError] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; path: string } | null>(
    null,
  );
  const [confirmPath, setConfirmPath] = useState<string | null>(null);
  const initialCachedViewRef = useRef<FileListView | null>(null);
  const [viewMode, setViewMode] = useState<FileListView>(() =>
    readSavedFileListView(initialCachedViewRef),
  );
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(
    () => new Set(),
  );
  const widthPersistTimerRef = useRef<number | null>(null);

  const persistSettingsPatch = useCallback(
    (patch: Partial<Pick<AppSettings, "gitDiffChangedFilesView" | "gitDiffChangedFilesWidth">>) => {
      queryClient.setQueryData<AppSettings>(queryKeys.settings, (current) =>
        current ? { ...current, ...patch } : current,
      );
      void api
        .updateSettings(patch)
        .then((next) => queryClient.setQueryData(queryKeys.settings, next))
        .catch((error) => {
          console.error("[settings] failed to persist git diff preference:", error);
        });
    },
    [queryClient],
  );

  const persistViewMode = useCallback(
    (next: FileListView) => {
      setViewMode(next);
      writeCachedGitDiffChangedFilesView(next);
      persistSettingsPatch({ gitDiffChangedFilesView: next });
    },
    [persistSettingsPatch],
  );

  const persistWidth = useCallback(
    (next: number) => {
      if (!settingsLoaded) return;
      const width = normalizeGitDiffChangedFilesWidth(next);
      if (width === null) return;
      if (widthPersistTimerRef.current) window.clearTimeout(widthPersistTimerRef.current);
      widthPersistTimerRef.current = window.setTimeout(() => {
        persistSettingsPatch({ gitDiffChangedFilesWidth: width });
      }, 250);
    },
    [persistSettingsPatch, settingsLoaded],
  );

  const { size: width, onMouseDown: onResizeMouseDown } = useResizablePanel({
    storageKey: GIT_DIFF_CHANGED_FILES_WIDTH_STORAGE_KEY,
    axis: "x",
    defaultSize: DEFAULT_GIT_DIFF_CHANGED_FILES_WIDTH,
    minSize: GIT_DIFF_CHANGED_FILES_WIDTH_MIN,
    maxSize: (vw) => Math.min(520, vw - 360),
    resizeEdge: "end",
    storedSize: storedWidth,
    onSizeChange: persistWidth,
  });

  const closeMenu = useCallback(() => setMenu(null), []);
  useDismissableMenu(menu !== null, closeMenu);

  useEffect(() => {
    if (!settingsLoaded) return;
    if (storedViewMode) {
      setViewMode(storedViewMode);
      writeCachedGitDiffChangedFilesView(storedViewMode);
      return;
    }
    const cached = initialCachedViewRef.current;
    if (cached) persistViewMode(cached);
  }, [persistViewMode, settingsLoaded, storedViewMode]);

  const toggleFolder = useCallback((path: string) => {
    setCollapsedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

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
        minWidth: GIT_DIFF_CHANGED_FILES_WIDTH_MIN,
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
      <FilesToolbar
        total={staged.length + unstaged.length}
        viewMode={viewMode}
        onViewModeChange={persistViewMode}
      />
      <div style={{ overflowY: "auto", flex: 1 }}>
        <Section
          label="Accepted Changes"
          count={staged.length}
          tone="staged"
          extra={
            <CommitPushButton
              projectId={projectId}
              worktreeId={worktreeId}
              label="Ship Accepted"
              title="commit & push"
              autoStage={false}
              showAheadBadge={false}
              variant="primary"
              enabled={enabled}
              onError={(m) => setShipError(m)}
              onNotice={() => setShipError(null)}
            />
          }
        >
          {staged.length === 0 ? (
            <Empty text="No accepted files" />
          ) : viewMode === "tree" ? (
            <FileTreeRows
              files={staged}
              sectionKey="staged"
              isStaged
              selection={selection}
              busyPaths={busyPaths}
              collapsedFolders={collapsedFolders}
              onToggleFolder={toggleFolder}
              onSelect={(file) => onSelect({ path: file.path, staged: true })}
              onAction={(file) => onUnstage([file.path])}
              onContextMenu={(e, file) => openMenu(e, file.path)}
            />
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
        >
          {unstaged.length === 0 ? (
            <Empty text="No changes" />
          ) : viewMode === "tree" ? (
            <FileTreeRows
              files={unstaged}
              sectionKey="unstaged"
              isStaged={false}
              selection={selection}
              busyPaths={busyPaths}
              collapsedFolders={collapsedFolders}
              onToggleFolder={toggleFolder}
              onSelect={(file) => onSelect({ path: file.path, staged: false })}
              onAction={(file) => onStage([file.path])}
              onContextMenu={(e, file) => openMenu(e, file.path)}
            />
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
        <div
          role="menu"
          aria-label="File actions"
          onClick={(e) => e.stopPropagation()}
          style={{
            position: "fixed",
            top: menu.y,
            left: menu.x,
            zIndex: 1000,
            background: "var(--surface-2)",
            border: "1px solid var(--border)",
            borderRadius: 6,
            padding: 4,
            minWidth: 140,
            boxShadow: "0 6px 20px rgba(0,0,0,0.4)",
          }}
        >
          <button
            type="button"
            role="menuitem"
            autoFocus
            onClick={(e) => {
              e.stopPropagation();
              const p = menu.path;
              setMenu(null);
              setConfirmPath(p);
            }}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              width: "100%",
              padding: "7px 10px",
              background: "transparent",
              border: 0,
              borderRadius: 4,
              cursor: "pointer",
              color: "var(--status-failed, #e06c75)",
              fontSize: 12,
              fontFamily: "var(--mono)",
              textAlign: "left",
            }}
            onMouseEnter={(e) =>
              (e.currentTarget.style.background = "var(--surface-3)")
            }
            onMouseLeave={(e) =>
              (e.currentTarget.style.background = "transparent")
            }
          >
            <Icon name="trash" size={12} /> Delete
          </button>
        </div>
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

function FilesToolbar({
  total,
  viewMode,
  onViewModeChange,
}: {
  total: number;
  viewMode: FileListView;
  onViewModeChange: (mode: FileListView) => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "7px 10px",
        borderBottom: "1px solid var(--border)",
        background: "rgba(3, 6, 8, 0.22)",
        flexShrink: 0,
      }}
    >
      <div
        style={{
          flex: 1,
          minWidth: 0,
          display: "flex",
          alignItems: "baseline",
          gap: 6,
          fontFamily: "var(--mono)",
          fontSize: 11,
          color: "var(--text-dim)",
        }}
      >
        <span style={{ color: "var(--text)", fontWeight: 600 }}>Files</span>
        <span style={{ color: "var(--text-faint)", fontVariantNumeric: "tabular-nums" }}>
          {total}
        </span>
      </div>
      <div
        role="group"
        aria-label="Changed files layout"
        style={{
          display: "inline-flex",
          alignItems: "center",
          padding: 2,
          border: "1px solid var(--border)",
          borderRadius: 5,
          background: "var(--surface-1)",
        }}
      >
        <ViewModeButton
          icon="list"
          label="List view"
          active={viewMode === "list"}
          onClick={() => onViewModeChange("list")}
        />
        <ViewModeButton
          icon="folder"
          label="Tree view"
          active={viewMode === "tree"}
          onClick={() => onViewModeChange("tree")}
        />
      </div>
    </div>
  );
}

function ViewModeButton({
  icon,
  label,
  active,
  onClick,
}: {
  icon: "list" | "folder";
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      style={{
        width: 24,
        height: 22,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        border: 0,
        borderRadius: 4,
        background: active ? "var(--surface-3)" : "transparent",
        color: active ? "var(--text)" : "var(--text-dim)",
        cursor: "pointer",
        padding: 0,
      }}
    >
      <Icon name={icon} size={12} />
    </button>
  );
}

function Section({
  label,
  count,
  tone,
  children,
  actionIcon,
  actionTitle,
  onAction,
  extra,
}: {
  label: string;
  count: number;
  tone: "staged" | "unstaged";
  children: React.ReactNode;
  actionIcon?: "plus" | "x";
  actionTitle?: string;
  onAction?: () => void;
  extra?: ReactNode;
}) {
  const sectionTone = SECTION_TONES[tone];

  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "8px 12px",
          background: sectionTone.header,
          borderBottom: `1px solid ${sectionTone.border}`,
          fontFamily: "var(--mono)",
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: "0.04em",
          textTransform: "uppercase",
          color: sectionTone.text,
          position: "sticky",
          top: 0,
          zIndex: 1,
        }}
      >
        <span
          style={{
            color: sectionTone.count,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {count}
        </span>
        <span style={{ flex: 1 }}>{label}</span>
        {onAction && actionIcon && actionTitle && (
          <button
            type="button"
            onClick={onAction}
            title={actionTitle}
            aria-label={actionTitle}
            style={textBtnStyle}
          >
            <Icon name={actionIcon} size={10} />
            <span>{actionTitle}</span>
          </button>
        )}
        {extra}
      </div>
      {children}
    </div>
  );
}

type FileTreeNode =
  | {
      kind: "dir";
      name: string;
      path: string;
      fileCount: number;
      children: FileTreeNode[];
    }
  | {
      kind: "file";
      name: string;
      path: string;
      file: GitChangedFile;
    };

function FileTreeRows({
  files,
  sectionKey,
  isStaged,
  selection,
  busyPaths,
  collapsedFolders,
  onToggleFolder,
  onSelect,
  onAction,
  onContextMenu,
}: {
  files: GitChangedFile[];
  sectionKey: "staged" | "unstaged";
  isStaged: boolean;
  selection: FileSelection;
  busyPaths: Set<string>;
  collapsedFolders: Set<string>;
  onToggleFolder: (path: string) => void;
  onSelect: (file: GitChangedFile) => void;
  onAction: (file: GitChangedFile) => void;
  onContextMenu: (e: React.MouseEvent, file: GitChangedFile) => void;
}) {
  const nodes = useMemo(() => buildFileTree(files), [files]);

  return (
    <>
      {nodes.map((node) => (
        <TreeNodeRow
          key={node.path}
          node={node}
          depth={0}
          sectionKey={sectionKey}
          isStaged={isStaged}
          selection={selection}
          busyPaths={busyPaths}
          collapsedFolders={collapsedFolders}
          onToggleFolder={onToggleFolder}
          onSelect={onSelect}
          onAction={onAction}
          onContextMenu={onContextMenu}
        />
      ))}
    </>
  );
}

function TreeNodeRow({
  node,
  depth,
  sectionKey,
  isStaged,
  selection,
  busyPaths,
  collapsedFolders,
  onToggleFolder,
  onSelect,
  onAction,
  onContextMenu,
}: {
  node: FileTreeNode;
  depth: number;
  sectionKey: "staged" | "unstaged";
  isStaged: boolean;
  selection: FileSelection;
  busyPaths: Set<string>;
  collapsedFolders: Set<string>;
  onToggleFolder: (path: string) => void;
  onSelect: (file: GitChangedFile) => void;
  onAction: (file: GitChangedFile) => void;
  onContextMenu: (e: React.MouseEvent, file: GitChangedFile) => void;
}) {
  if (node.kind === "dir") {
    const collapseKey = `${sectionKey}:${node.path}`;
    const collapsed = collapsedFolders.has(collapseKey);
    return (
      <>
        <button
          type="button"
          onClick={() => onToggleFolder(collapseKey)}
          aria-expanded={!collapsed}
          title={node.path}
          style={{
            width: "100%",
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: `5px 10px 5px ${12 + depth * 14}px`,
            border: 0,
            background: "transparent",
            color: "var(--text-dim)",
            cursor: "pointer",
            textAlign: "left",
            fontFamily: "var(--mono)",
            fontSize: 11,
          }}
          onMouseEnter={(e) =>
            (e.currentTarget.style.background = "var(--surface-1)")
          }
          onMouseLeave={(e) =>
            (e.currentTarget.style.background = "transparent")
          }
        >
          <Icon name={collapsed ? "chevron-right" : "chevron-down"} size={10} />
          <Icon name="folder" size={12} />
          <span
            style={{
              flex: 1,
              minWidth: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              color: "var(--text)",
            }}
          >
            {node.name}
          </span>
          <span
            style={{
              flexShrink: 0,
              color: "var(--text-faint)",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {node.fileCount}
          </span>
        </button>
        {!collapsed &&
          node.children.map((child) => (
            <TreeNodeRow
              key={child.path}
              node={child}
              depth={depth + 1}
              sectionKey={sectionKey}
              isStaged={isStaged}
              selection={selection}
              busyPaths={busyPaths}
              collapsedFolders={collapsedFolders}
              onToggleFolder={onToggleFolder}
              onSelect={onSelect}
              onAction={onAction}
              onContextMenu={onContextMenu}
            />
          ))}
      </>
    );
  }

  return (
    <FileRow
      file={node.file}
      isStaged={isStaged}
      isSelected={selection?.staged === isStaged && selection.path === node.path}
      isBusy={busyPaths.has(node.path)}
      depth={depth}
      showFileIcon
      showDir={false}
      onSelect={() => onSelect(node.file)}
      onAction={() => onAction(node.file)}
      onContextMenu={(e) => onContextMenu(e, node.file)}
    />
  );
}

function FileRow({
  file,
  isStaged,
  isSelected,
  isBusy,
  depth = 0,
  showFileIcon = false,
  showDir = true,
  onSelect,
  onAction,
  onContextMenu,
}: {
  file: GitChangedFile;
  isStaged: boolean;
  isSelected: boolean;
  isBusy: boolean;
  depth?: number;
  showFileIcon?: boolean;
  showDir?: boolean;
  onSelect: () => void;
  onAction: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
}) {
  const { letter: statusLetter, color: statusColor } = STATUS_META[file.status];
  const display = displayPath(file.path);
  return (
    <div
      onClick={onSelect}
      onContextMenu={onContextMenu}
      role="button"
      aria-pressed={isSelected}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: `5px 10px 5px ${12 + depth * 14}px`,
        cursor: "pointer",
        background: isSelected ? "var(--surface-2)" : "transparent",
        opacity: isBusy ? 0.5 : 1,
        transition: "background 0.08s",
      }}
      onMouseEnter={(e) => {
        if (!isSelected)
          e.currentTarget.style.background = "var(--surface-1)";
      }}
      onMouseLeave={(e) => {
        if (!isSelected) e.currentTarget.style.background = "transparent";
      }}
    >
      {showFileIcon && (
        <>
          <span style={{ width: 10, flexShrink: 0 }} />
          <Icon
            name="file"
            size={12}
            style={{ color: "var(--text-faint)", flexShrink: 0 }}
          />
        </>
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: 6,
            minWidth: 0,
            fontSize: 12,
            color: "var(--text)",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textAlign: "left",
          }}
          title={file.path}
        >
          <span
            style={{
              minWidth: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
              flex: "0 1 auto",
            }}
          >
            {display.basename}
          </span>
          {showDir && display.dir && (
            <span
              style={{
                minWidth: 0,
                overflow: "hidden",
                textOverflow: "ellipsis",
                flex: "1 1 auto",
                color: "var(--text-faint)",
                fontFamily: "var(--mono)",
                fontSize: 10,
              }}
            >
              &lt;{display.dir}&gt;
            </span>
          )}
        </div>
      </div>
      <span
        title={file.status}
        style={{
          fontFamily: "var(--mono)",
          fontSize: 10.5,
          fontWeight: 600,
          color: statusColor,
          width: 12,
          textAlign: "center",
          flexShrink: 0,
        }}
      >
        {statusLetter}
      </span>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onAction();
        }}
        disabled={isBusy}
        title={isStaged ? "Unaccept" : "Accept"}
        aria-label={isStaged ? `Unaccept ${file.path}` : `Accept ${file.path}`}
        style={iconBtnStyle}
      >
        <Icon name={isStaged ? "x" : "plus"} size={11} />
      </button>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div
      style={{
        padding: "8px 12px",
        fontFamily: "var(--mono)",
        fontSize: 11,
        color: "var(--text-faint)",
      }}
    >
      {text}
    </div>
  );
}

function buildFileTree(files: GitChangedFile[]): FileTreeNode[] {
  const root: MutableTreeDir = {
    name: "",
    path: "",
    fileCount: 0,
    dirs: new Map(),
    files: [],
  };

  for (const file of files) {
    const parts = file.path.split("/").filter(Boolean);
    if (parts.length <= 1) {
      root.files.push(file);
      continue;
    }

    let current = root;
    current.fileCount += 1;
    for (const part of parts.slice(0, -1)) {
      const path = current.path ? `${current.path}/${part}` : part;
      let dir = current.dirs.get(part);
      if (!dir) {
        dir = {
          name: part,
          path,
          fileCount: 0,
          dirs: new Map(),
          files: [],
        };
        current.dirs.set(part, dir);
      }
      dir.fileCount += 1;
      current = dir;
    }
    current.files.push(file);
  }

  return dirChildren(root);
}

function dirChildren(dir: MutableTreeDir): FileTreeNode[] {
  const dirs: FileTreeNode[] = Array.from(dir.dirs.values())
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((child) => ({
      kind: "dir" as const,
      name: child.name,
      path: child.path,
      fileCount: child.fileCount,
      children: dirChildren(child),
    }));

  const files: FileTreeNode[] = dir.files
    .slice()
    .sort((a, b) =>
      displayPath(a.path).basename.localeCompare(displayPath(b.path).basename),
    )
    .map((file) => ({
      kind: "file" as const,
      name: displayPath(file.path).basename,
      path: file.path,
      file,
    }));

  return [...dirs, ...files];
}

function readSavedFileListView(initialCachedViewRef: {
  current: FileListView | null;
}): FileListView {
  const cached = readCachedGitDiffChangedFilesView();
  initialCachedViewRef.current = cached;
  return cached ?? DEFAULT_GIT_DIFF_CHANGED_FILES_VIEW;
}

export function displayPath(p: string): { basename: string; dir: string } {
  const idx = p.lastIndexOf("/");
  if (idx < 0) return { basename: p, dir: "" };
  return { basename: p.slice(idx + 1), dir: p.slice(0, idx) };
}

const textBtnStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 4,
  background: "transparent",
  border: "1px solid var(--border)",
  borderRadius: 4,
  color: "var(--text-dim)",
  cursor: "pointer",
  padding: "2px 6px",
  fontFamily: "var(--mono)",
  fontSize: 10,
  fontWeight: 600,
  letterSpacing: "0.04em",
  textTransform: "uppercase",
  flexShrink: 0,
};

const SECTION_HEADER_BACKGROUND = "rgba(3, 6, 8, 0.22)";

const SECTION_TONES = {
  staged: {
    header: SECTION_HEADER_BACKGROUND,
    border: "var(--border)",
    text: "#baf3c3",
    count: "rgba(186, 243, 195, 0.72)",
  },
  unstaged: {
    header: SECTION_HEADER_BACKGROUND,
    border: "var(--border)",
    text: "#f3d58a",
    count: "rgba(243, 213, 138, 0.72)",
  },
} satisfies Record<
  "staged" | "unstaged",
  { header: string; border: string; text: string; count: string }
>;

const iconBtnStyle: CSSProperties = {
  background: "transparent",
  border: 0,
  color: "var(--text-dim)",
  cursor: "pointer",
  padding: 3,
  borderRadius: 4,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  flexShrink: 0,
};
