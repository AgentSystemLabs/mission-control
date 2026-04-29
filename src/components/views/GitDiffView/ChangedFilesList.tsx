import { useEffect, useState, type CSSProperties } from "react";
import { Icon } from "~/components/ui/Icon";
import { ConfirmDialog } from "~/components/ui/ConfirmDialog";
import type { GitChangedFile, GitFileStatus } from "~/server/services/git";

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
}) {
  const [menu, setMenu] = useState<{ x: number; y: number; path: string } | null>(
    null,
  );
  const [confirmPath, setConfirmPath] = useState<string | null>(null);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("click", close);
    window.addEventListener("scroll", close, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [menu]);

  const openMenu = (e: React.MouseEvent, path: string) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ x: e.clientX, y: e.clientY, path });
  };

  return (
    <div
      style={{
        flexShrink: 0,
        width: 300,
        borderRight: "1px solid var(--border)",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        background: "var(--surface-0)",
      }}
    >
      <div style={{ overflowY: "auto", flex: 1 }}>
        <Section
          label="Staged Changes"
          count={staged.length}
          actionIcon="x"
          actionTitle="Unstage all"
          onAction={staged.length > 0 ? onUnstageAll : undefined}
        >
          {staged.length === 0 ? (
            <Empty text="No staged files" />
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
          actionIcon="plus"
          actionTitle="Stage all"
          onAction={unstaged.length > 0 ? onStageAll : undefined}
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

function Section({
  label,
  count,
  children,
  actionIcon,
  actionTitle,
  onAction,
}: {
  label: string;
  count: number;
  children: React.ReactNode;
  actionIcon: "plus" | "x";
  actionTitle: string;
  onAction?: () => void;
}) {
  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "8px 12px",
          background: "var(--surface-1)",
          borderTop: "1px solid var(--border)",
          borderBottom: "1px solid var(--border)",
          fontFamily: "var(--mono)",
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: "0.04em",
          textTransform: "uppercase",
          color: "var(--text-dim)",
          position: "sticky",
          top: 0,
          zIndex: 1,
        }}
      >
        <span style={{ flex: 1 }}>{label}</span>
        <span
          style={{
            color: "var(--text-faint)",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {count}
        </span>
        {onAction && (
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
      </div>
      {children}
    </div>
  );
}

function FileRow({
  file,
  isStaged,
  isSelected,
  isBusy,
  onSelect,
  onAction,
  onContextMenu,
}: {
  file: GitChangedFile;
  isStaged: boolean;
  isSelected: boolean;
  isBusy: boolean;
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
        padding: "5px 10px 5px 12px",
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
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 12,
            color: "var(--text)",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            direction: "rtl",
            textAlign: "left",
          }}
          title={file.path}
        >
          {/* `direction: rtl` keeps the file name visible when truncating. */}
          <span style={{ unicodeBidi: "plaintext" }}>{display.basename}</span>
        </div>
        {display.dir && (
          <div
            style={{
              fontFamily: "var(--mono)",
              fontSize: 10,
              color: "var(--text-faint)",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
            title={display.dir}
          >
            {display.dir}
          </div>
        )}
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
        title={isStaged ? "Unstage" : "Stage"}
        aria-label={isStaged ? `Unstage ${file.path}` : `Stage ${file.path}`}
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

function displayPath(p: string): { basename: string; dir: string } {
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
