import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { useQuery } from "@tanstack/react-query";
import { Modal } from "~/components/ui/Modal";
import { Icon } from "~/components/ui/Icon";
import { Kbd } from "~/components/ui/Kbd";
import { rankFiles } from "~/lib/file-fuzzy";
import {
  buildFilePathTree,
  displayFilePath,
  flattenFilePathTree,
  type FilePathTreeNode,
} from "~/lib/file-tree";
import { listProjectFiles } from "~/lib/project-fs";
import {
  readCachedFileFinderView,
  writeCachedFileFinderView,
} from "~/lib/ui-preference-cache";
import { DEFAULT_FILE_FINDER_VIEW, type FileFinderView } from "~/shared/ui-preferences";

const VISIBLE_LIMIT = 200;
type FileFinderViewMode = FileFinderView;

export function FileFinderDialog({
  open,
  projectRoot,
  resetKey = 0,
  onClose,
  onPick,
}: {
  open: boolean;
  projectRoot: string;
  resetKey?: number;
  onClose: () => void;
  onPick: (relPath: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const [viewMode, setViewMode] = useState<FileFinderViewMode>(
    () => readCachedFileFinderView() ?? DEFAULT_FILE_FINDER_VIEW,
  );
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(
    () => new Set(),
  );
  const inputRef = useRef<HTMLInputElement>(null);
  const itemRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const lastResetKeyRef = useRef<number | null>(null);

  // Lazy: only fetch the file list when the dialog is opened.
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["files:list", projectRoot],
    queryFn: async () => {
      // Routes to the in-container clone (remoteFs) when Terminal runtime = Docker.
      const r = await listProjectFiles(projectRoot);
      if (!r.ok) throw new Error(r.error);
      return r.files;
    },
    enabled: open && !!projectRoot,
    staleTime: 30_000,
  });

  const ranked = useMemo(() => {
    const files = data ?? [];
    return rankFiles(query.trim(), files, VISIBLE_LIMIT);
  }, [data, query]);

  const treeNodes = useMemo(
    () => buildFilePathTree(ranked.map((r) => r.path)),
    [ranked],
  );

  const visiblePaths = useMemo(
    () =>
      viewMode === "tree"
        ? flattenFilePathTree(treeNodes, collapsedFolders)
        : ranked.map((r) => r.path),
    [collapsedFolders, ranked, treeNodes, viewMode],
  );

  const highlightedPath = visiblePaths[highlight] ?? null;

  const visibleIndexByPath = useMemo(
    () => new Map(visiblePaths.map((path, index) => [path, index])),
    [visiblePaths],
  );

  const setItemRef = useCallback((path: string, el: HTMLButtonElement | null) => {
    if (el) itemRefs.current.set(path, el);
    else itemRefs.current.delete(path);
  }, []);

  const setHighlightForPath = useCallback(
    (path: string) => {
      const next = visibleIndexByPath.get(path);
      if (next !== undefined) setHighlight(next);
    },
    [visibleIndexByPath],
  );

  const toggleFolder = useCallback((path: string) => {
    setCollapsedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const changeViewMode = useCallback((next: FileFinderViewMode) => {
    setViewMode(next);
    setHighlight(0);
    writeCachedFileFinderView(next);
  }, []);

  useEffect(() => {
    if (!open) return;
    if (lastResetKeyRef.current !== resetKey) {
      setQuery("");
      setHighlight(0);
      setCollapsedFolders(new Set());
      lastResetKeyRef.current = resetKey;
    }
    const t = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, [open, resetKey]);

  // When query changes, refresh the file list in the background so renames/new files appear.
  useEffect(() => {
    if (!open) return;
    void refetch();
  }, [open, refetch]);

  useEffect(() => {
    if (highlight >= visiblePaths.length) setHighlight(0);
  }, [visiblePaths.length, highlight]);

  useEffect(() => {
    if (!open) return;
    if (!highlightedPath) return;
    itemRefs.current.get(highlightedPath)?.scrollIntoView({ block: "nearest" });
  }, [open, highlightedPath]);

  const choose = (p: string) => {
    onPick(p);
    onClose();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      const n = visiblePaths.length;
      if (n > 0) setHighlight((h) => (h + 1) % n);
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      const n = visiblePaths.length;
      if (n > 0) setHighlight((h) => (h - 1 + n) % n);
      return;
    }
    if (e.key === "Enter") {
      const target = visiblePaths[highlight];
      if (target) {
        e.preventDefault();
        choose(target);
      }
    }
  };

  if (!open) return null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      width={640}
      maxHeight="70vh"
      placement="top"
      zIndex={100}
      contentStyle={{ padding: 4 }}
      title={
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            minWidth: 0,
          }}
        >
          <Icon name="search" size={13} style={{ color: "var(--text-faint)" }} />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setHighlight(0);
              setCollapsedFolders(new Set());
            }}
            onKeyDown={onKeyDown}
            placeholder="Search files in this project…"
            style={{
              flex: 1,
              background: "transparent",
              border: "none",
              outline: "none",
              fontFamily: "var(--mono)",
              fontSize: 13,
              color: "var(--text)",
            }}
          />
          <FileFinderViewToggle viewMode={viewMode} onViewModeChange={changeViewMode} />
          <Kbd variant="inline">Esc</Kbd>
        </div>
      }
      footer={
        <>
          <span>
            {data ? `${ranked.length} / ${data.length}` : "—"}
          </span>
          <span style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <span>
              <Kbd variant="inline">↑↓</Kbd> navigate
            </span>
            <span>
              <Kbd variant="inline">Enter</Kbd> open
            </span>
          </span>
        </>
      }
      footerStyle={{
        justifyContent: "space-between",
        alignItems: "center",
        fontFamily: "var(--mono)",
        fontSize: 10.5,
        color: "var(--text-faint)",
      }}
    >
      <div style={{ flex: 1, overflowY: "auto" }}>
        {error ? (
          <Status>Error: {String((error as Error).message)}</Status>
        ) : isLoading && !data ? (
          <Status>Indexing…</Status>
        ) : ranked.length === 0 ? (
          <Status>{(data?.length ?? 0) === 0 ? "No files found." : "No matches."}</Status>
        ) : viewMode === "tree" ? (
          <FileFinderTreeRows
            nodes={treeNodes}
            highlightedPath={highlightedPath}
            collapsedFolders={collapsedFolders}
            onToggleFolder={toggleFolder}
            onChoose={choose}
            onHighlightPath={setHighlightForPath}
            setItemRef={setItemRef}
          />
        ) : (
          ranked.map((r, i) => {
            return (
              <FileFinderFileRow
                key={r.path}
                path={r.path}
                highlighted={r.path === highlightedPath}
                onChoose={choose}
                onMouseMove={() => setHighlight(i)}
                setItemRef={setItemRef}
              />
            );
          })
        )}
      </div>
    </Modal>
  );
}

function FileFinderViewToggle({
  viewMode,
  onViewModeChange,
}: {
  viewMode: FileFinderViewMode;
  onViewModeChange: (mode: FileFinderViewMode) => void;
}) {
  return (
    <div
      role="group"
      aria-label="File finder layout"
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: 2,
        border: "1px solid var(--border)",
        borderRadius: 5,
        background: "var(--surface-1)",
        flexShrink: 0,
      }}
    >
      <FileFinderViewButton
        icon="list"
        label="List view"
        active={viewMode === "list"}
        onClick={() => onViewModeChange("list")}
      />
      <FileFinderViewButton
        icon="folder"
        label="Tree view"
        active={viewMode === "tree"}
        onClick={() => onViewModeChange("tree")}
      />
    </div>
  );
}

function FileFinderViewButton({
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
      onMouseDown={(e) => e.preventDefault()}
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

function FileFinderTreeRows({
  nodes,
  highlightedPath,
  collapsedFolders,
  onToggleFolder,
  onChoose,
  onHighlightPath,
  setItemRef,
}: {
  nodes: FilePathTreeNode[];
  highlightedPath: string | null;
  collapsedFolders: Set<string>;
  onToggleFolder: (path: string) => void;
  onChoose: (path: string) => void;
  onHighlightPath: (path: string) => void;
  setItemRef: (path: string, el: HTMLButtonElement | null) => void;
}) {
  return (
    <>
      {nodes.map((node) => (
        <FileFinderTreeNodeRow
          key={node.path}
          node={node}
          depth={0}
          highlightedPath={highlightedPath}
          collapsedFolders={collapsedFolders}
          onToggleFolder={onToggleFolder}
          onChoose={onChoose}
          onHighlightPath={onHighlightPath}
          setItemRef={setItemRef}
        />
      ))}
    </>
  );
}

function FileFinderTreeNodeRow({
  node,
  depth,
  highlightedPath,
  collapsedFolders,
  onToggleFolder,
  onChoose,
  onHighlightPath,
  setItemRef,
}: {
  node: FilePathTreeNode;
  depth: number;
  highlightedPath: string | null;
  collapsedFolders: Set<string>;
  onToggleFolder: (path: string) => void;
  onChoose: (path: string) => void;
  onHighlightPath: (path: string) => void;
  setItemRef: (path: string, el: HTMLButtonElement | null) => void;
}) {
  if (node.kind === "file") {
    return (
      <FileFinderFileRow
        path={node.path}
        highlighted={node.path === highlightedPath}
        depth={depth}
        showFileIcon
        showDir={false}
        onChoose={onChoose}
        onMouseMove={() => onHighlightPath(node.path)}
        setItemRef={setItemRef}
      />
    );
  }

  const collapsed = collapsedFolders.has(node.path);
  return (
    <>
      <button
        type="button"
        onClick={() => onToggleFolder(node.path)}
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
        onMouseEnter={(e) => {
          e.currentTarget.style.background = "var(--surface-1)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = "transparent";
        }}
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
          <FileFinderTreeNodeRow
            key={child.path}
            node={child}
            depth={depth + 1}
            highlightedPath={highlightedPath}
            collapsedFolders={collapsedFolders}
            onToggleFolder={onToggleFolder}
            onChoose={onChoose}
            onHighlightPath={onHighlightPath}
            setItemRef={setItemRef}
          />
        ))}
    </>
  );
}

function FileFinderFileRow({
  path,
  highlighted,
  depth = 0,
  showFileIcon = false,
  showDir = true,
  onChoose,
  onMouseMove,
  setItemRef,
}: {
  path: string;
  highlighted: boolean;
  depth?: number;
  showFileIcon?: boolean;
  showDir?: boolean;
  onChoose: (path: string) => void;
  onMouseMove: () => void;
  setItemRef: (path: string, el: HTMLButtonElement | null) => void;
}) {
  const display = displayFilePath(path);
  return (
    <button
      type="button"
      ref={(el) => setItemRef(path, el)}
      onClick={() => onChoose(path)}
      onMouseMove={onMouseMove}
      title={path}
      style={{
        ...fileRowStyle,
        alignItems: showFileIcon ? "center" : "baseline",
        padding: `6px 10px 6px ${12 + depth * 14}px`,
        background: highlighted ? "var(--surface-2, var(--surface-1))" : "transparent",
        outline: highlighted ? "1px solid var(--border)" : "none",
      }}
    >
      {showFileIcon && (
        <>
          <span style={{ width: 10, flexShrink: 0 }} />
          <Icon name="file" size={12} style={{ color: "var(--text-faint)", flexShrink: 0 }} />
        </>
      )}
      <span style={{ flexShrink: 0, fontWeight: 600 }}>{display.basename}</span>
      {showDir && display.dir && (
        <span
          style={{
            flex: 1,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            color: "var(--text-faint)",
            fontSize: 11,
          }}
        >
          {display.dir}
        </span>
      )}
    </button>
  );
}

function Status({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        padding: 14,
        fontFamily: "var(--mono)",
        fontSize: 12,
        color: "var(--text-faint)",
        textAlign: "center",
      }}
    >
      {children}
    </div>
  );
}

const fileRowStyle: CSSProperties = {
  width: "100%",
  display: "flex",
  gap: 8,
  border: "none",
  borderRadius: 4,
  cursor: "pointer",
  textAlign: "left",
  fontFamily: "var(--mono)",
  fontSize: 12,
  color: "var(--text)",
};
