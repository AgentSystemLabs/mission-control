import {
  Component,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ErrorInfo,
  type ReactNode,
  type RefObject,
} from "react";
import CodeMirror, { EditorView, type ReactCodeMirrorRef } from "@uiw/react-codemirror";
import type { Extension } from "@codemirror/state";
import { oneDark } from "@codemirror/theme-one-dark";
import { Modal } from "~/components/ui/Modal";
import { Btn } from "~/components/ui/Btn";
import { Icon } from "~/components/ui/Icon";
import { HtmlPreview } from "~/components/views/HtmlPreview";
import { MarkdownAnnotator } from "~/components/views/MarkdownAnnotator";
import { HotkeyTooltip, StaticHotkeyTooltip, EscTooltip } from "~/components/ui/Tooltip";
import { ConfirmDialog } from "~/components/ui/ConfirmDialog";
import { useHotkey } from "~/lib/use-hotkey";
import { languageForFilename } from "~/lib/file-language";
import { isHtmlFilename, isMarkdownFilename } from "~/lib/file-preview";
import {
  readProjectFile,
  writeProjectFile,
  writeProjectFileSensitive,
  watchProjectFile,
  type ProjectFileWatch,
} from "~/lib/project-fs";
import type { FileReadError, FileReadResult } from "~/shared/electron-contract";
import { FILE_READ_MAX_BYTES, FILE_READ_MAX_LINES } from "~/shared/file-read-limits";

type FileReadSuccess = Extract<FileReadResult, { ok: true }>;

type LoadedFile =
  | {
      kind: "text";
      content: string;
      mtimeMs: number;
    }
  | {
      kind: "image";
      dataUrl: string;
      mimeType: string;
      size: number;
      mtimeMs: number;
    };

type LoadError = FileReadError | string;
type EditorMode = "edit" | "preview";

export function FileEditorDialog({
  projectRoot,
  relPath,
  onClose,
  onBack,
}: {
  projectRoot: string;
  relPath: string | null;
  onClose: () => void;
  onBack?: () => void;
}) {
  const open = relPath !== null;
  const [loaded, setLoaded] = useState<LoadedFile | null>(null);
  const [content, setContent] = useState("");
  const [loadError, setLoadError] = useState<{ kind: LoadError; lineCount?: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [externalChanged, setExternalChanged] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [pendingExit, setPendingExit] = useState<"close" | "back">("close");
  const [editorMode, setEditorMode] = useState<EditorMode>("edit");
  const watchIdRef = useRef<string | null>(null);
  const mtimeRef = useRef<number>(0);
  const savingRef = useRef(false);
  const cmRef = useRef<ReactCodeMirrorRef>(null);

  if (loaded) mtimeRef.current = loaded.mtimeMs;

  const dirty = loaded?.kind === "text" && content !== loaded.content;
  const contentRef = useRef(content);
  contentRef.current = content;
  const slash = relPath ? relPath.lastIndexOf("/") : -1;
  const fileName = relPath ? (slash >= 0 ? relPath.slice(slash + 1) : relPath) : "";
  const dirPath = relPath && slash >= 0 ? relPath.slice(0, slash) : "";
  const markdownFile = isMarkdownFilename(relPath);
  const htmlFile = isHtmlFilename(relPath);
  const previewableTextFile = markdownFile || htmlFile;

  // Load on open / relPath change.
  useEffect(() => {
    if (!open || !relPath || !window.electronAPI) return;
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    setLoaded(null);
    setContent("");
    setExternalChanged(false);
    setSaveError(null);
    void (async () => {
      const r = await readProjectFile(projectRoot, relPath);
      if (cancelled) return;
      if (r.ok) {
        const next = toLoadedFile(r);
        setLoaded(next);
        setContent(next.kind === "text" ? next.content : "");
      } else {
        setLoadError({ kind: r.error, lineCount: r.lineCount });
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, projectRoot, relPath]);

  useEffect(() => {
    setEditorMode(htmlFile ? "preview" : "edit");
  }, [htmlFile]);

  // Mount file watcher once per open file. The watcher fires on every external
  // mtime advance and we read the current mtime via ref, so saves don't tear it down.
  const hasLoaded = loaded !== null;
  useEffect(() => {
    if (!open || !relPath || !hasLoaded || !window.electronAPI) return;
    let active = true;
    let unsub: (() => void) | undefined;
    let activeWatch: ProjectFileWatch | null = null;
    void (async () => {
      const r = await watchProjectFile(projectRoot, relPath);
      if (!active) {
        if (r.ok) r.watch.unwatch();
        return;
      }
      if (!r.ok) return;
      activeWatch = r.watch;
      watchIdRef.current = r.watch.watchId;
      unsub = r.watch.onChanged((msg) => {
        if (msg.watchId !== r.watch.watchId) return;
        if (savingRef.current) return;
        if (msg.mtimeMs <= mtimeRef.current) return;
        void handleExternalChange();
      });
    })();
    return () => {
      active = false;
      unsub?.();
      watchIdRef.current = null;
      activeWatch?.unwatch();
    };
  }, [open, projectRoot, relPath, hasLoaded]);

  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;

  const handleExternalChange = useCallback(async () => {
    if (!relPath || !window.electronAPI) return;
    const r = await readProjectFile(projectRoot, relPath);
    if (!r.ok) return;
    const next = toLoadedFile(r);
    // Our own save can race the watcher: disk already matches the editor.
    if (next.kind === "text" && next.content === contentRef.current) {
      mtimeRef.current = next.mtimeMs;
      setLoaded(next);
      setExternalChanged(false);
      return;
    }
    if (dirtyRef.current) {
      setLoaded((prev) => (prev ? { ...prev, mtimeMs: next.mtimeMs } : prev));
      setExternalChanged(true);
      return;
    }
    // Silent reload — preserve scroll + selection.
    const view = cmRef.current?.view;
    const scrollTop = view?.scrollDOM.scrollTop ?? 0;
    const selection = view?.state.selection;
    setLoaded(next);
    setContent(next.kind === "text" ? next.content : "");
    setExternalChanged(false);
    requestAnimationFrame(() => {
      const v = cmRef.current?.view;
      if (!v) return;
      v.scrollDOM.scrollTop = scrollTop;
      if (selection) {
        try {
          v.dispatch({ selection });
        } catch {
          // selection may be out of range after reload; ignore.
        }
      }
    });
  }, [projectRoot, relPath]);

  const doSave = useCallback(
    async (forceOverwrite: boolean): Promise<boolean> => {
      if (!relPath || !window.electronAPI || !loaded) return false;
      if (loaded.kind !== "text") return false;
      savingRef.current = true;
      setSaving(true);
      setSaveError(null);
      const expectedMtime = forceOverwrite ? null : loaded.mtimeMs;
      let r = await writeProjectFile(projectRoot, relPath, content, expectedMtime);
      // Sensitive paths (.claude/settings.local.json, .git/hooks/*, package.json,
      // .vscode/tasks.json, etc.) are rejected by `files:write` and must go
      // through `files:writeSensitive`, which surfaces a native OS confirm
      // dialog in the main process. The retry is silent — the user sees one
      // dialog, not an error followed by a re-click.
      if (!r.ok && r.error === "protected-path") {
        r = await writeProjectFileSensitive(projectRoot, relPath, content, expectedMtime);
      }
      if (r.ok) {
        mtimeRef.current = r.mtimeMs;
        setLoaded({ kind: "text", content, mtimeMs: r.mtimeMs });
        setExternalChanged(false);
        setSaving(false);
        savingRef.current = false;
        return true;
      }
      setSaving(false);
      savingRef.current = false;
      if (r.error === "stale") {
        setExternalChanged(true);
        setSaveError("File changed on disk. Discard your edits and reload, or overwrite anyway.");
        return false;
      }
      // User clicked Cancel in the native confirm dialog — no-op, not an error.
      if (r.error === "user-declined") {
        return false;
      }
      setSaveError(r.error);
      return false;
    },
    [projectRoot, relPath, loaded, content],
  );

  const saveAndClose = useCallback(async () => {
    if (loaded?.kind !== "text" || !dirty) {
      onClose();
      return;
    }
    const ok = await doSave(false);
    if (ok) onClose();
  }, [loaded, dirty, doSave, onClose]);

  // Markdown "Refine" writes the model's rewrite straight to disk (force
  // overwrite — the refine is an intentional edit the user kicked off) instead
  // of leaving it as an unsaved buffer. The annotator invokes this as a floating
  // promise, so the write runs to completion even if the dialog was closed
  // mid-refine: the user can start a refine, close the panel, and find the saved
  // result on disk when they reopen. When still mounted, the setState calls sync
  // the editor; after unmount they are harmless no-ops. Mirrors doSave's
  // protected-path retry and savingRef/mtime bookkeeping.
  const persistRefined = useCallback(
    async (refined: string): Promise<void> => {
      if (!relPath || !window.electronAPI) throw new Error("Not running in Electron");
      savingRef.current = true;
      try {
        let r = await writeProjectFile(projectRoot, relPath, refined, null);
        if (!r.ok && r.error === "protected-path") {
          r = await writeProjectFileSensitive(projectRoot, relPath, refined, null);
        }
        if (r.ok) {
          mtimeRef.current = r.mtimeMs;
          // The refined document is now on disk. If the user made manual edits in
          // the buffer during the (multi-second) refine, don't silently discard
          // them — record the new on-disk state and surface the standard conflict
          // bar (Discard mine & reload / Overwrite). Otherwise sync the editor to
          // the refined text.
          if (dirtyRef.current) {
            setLoaded((prev) => (prev ? { ...prev, mtimeMs: r.mtimeMs } : prev));
            setExternalChanged(true);
          } else {
            setLoaded({ kind: "text", content: refined, mtimeMs: r.mtimeMs });
            setContent(refined);
            setExternalChanged(false);
          }
          setSaveError(null);
          return;
        }
        if (r.error === "user-declined") {
          throw new Error("Save was declined — the refined document was not written.");
        }
        throw new Error(typeof r.error === "string" ? r.error : "Failed to save refined file");
      } finally {
        savingRef.current = false;
      }
    },
    [projectRoot, relPath],
  );

  const discardAndReload = useCallback(async () => {
    if (!relPath || !window.electronAPI) return;
    const r = await readProjectFile(projectRoot, relPath);
    if (!r.ok) return;
    const next = toLoadedFile(r);
    setLoaded(next);
    setContent(next.kind === "text" ? next.content : "");
    setExternalChanged(false);
    setSaveError(null);
  }, [projectRoot, relPath]);

  useHotkey("file.save", (e) => {
    if (!open) return;
    e.preventDefault();
    void doSave(false);
  }, { enabled: open });

  const requestClose = useCallback(() => {
    if (dirtyRef.current) {
      setPendingExit("close");
      setConfirmClose(true);
      return;
    }
    onClose();
  }, [onClose]);

  const requestBack = useCallback(() => {
    if (!onBack) {
      requestClose();
      return;
    }
    if (dirtyRef.current) {
      setPendingExit("back");
      setConfirmClose(true);
      return;
    }
    onBack();
  }, [onBack, requestClose]);

  if (!open) return null;

  const showMarkdownPreview = loaded?.kind === "text" && markdownFile && editorMode === "preview";
  const showHtmlPreview = loaded?.kind === "text" && htmlFile && editorMode === "preview";
  const showingRenderedPreview = showMarkdownPreview || showHtmlPreview;

  return (
    <>
      <Modal
        open={open}
        onClose={requestClose}
        width="80vw"
        height="82vh"
        maxWidth={1200}
        zIndex={100}
        contentStyle={{
          padding: 0,
          display: "flex",
          flexDirection: "column",
          minHeight: 0,
          overflow: "hidden",
        }}
        footer={
          <>
            <span
              style={{
                flex: 1,
                fontFamily: "var(--mono)",
                fontSize: 10.5,
                color: "var(--text-faint)",
              }}
            >
              {loaded?.kind === "text"
                ? `${content.length.toLocaleString()} chars`
                : loaded?.kind === "image"
                  ? `${loaded.mimeType} · ${formatBytes(loaded.size)}`
                  : ""}
            </span>
            <StaticHotkeyTooltip hotkey="Esc">
              <Btn variant="ghost" onClick={requestClose}>
                Close
              </Btn>
            </StaticHotkeyTooltip>
            <Btn
              variant="primary"
              icon="check"
              onClick={() => void saveAndClose()}
              disabled={!loaded || saving}
            >
              {saving ? "Saving…" : "Save and close"}
            </Btn>
            <HotkeyTooltip action="file.save">
              <Btn
                variant="primary"
                icon="check"
                onClick={() => void doSave(false)}
                disabled={!loaded || saving || !dirty}
              >
                {saving ? "Saving…" : "Save"}
              </Btn>
            </HotkeyTooltip>
          </>
        }
        footerStyle={{
          alignItems: "center",
          gap: 10,
          padding: "10px 16px",
        }}
        title={
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              minWidth: 0,
              width: "100%",
            }}
          >
            {onBack && (
              <button
                type="button"
                onClick={requestBack}
                aria-label="Back to file finder"
                title="Back to file finder"
                style={{
                  width: 26,
                  height: 26,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  border: "1px solid var(--border)",
                  borderRadius: 4,
                  background: "var(--surface-1)",
                  color: "var(--text-dim)",
                  cursor: "pointer",
                  flexShrink: 0,
                  padding: 0,
                }}
              >
                <Icon name="chevron-left" size={13} />
              </button>
            )}
            <span
              style={{
                fontFamily: "var(--mono)",
                fontSize: 12.5,
                fontWeight: 600,
                color: "var(--text)",
                flexShrink: 1,
                minWidth: 0,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
              title={fileName}
            >
              {fileName}
            </span>
            {dirPath && (
              <span
                style={{
                  fontFamily: "var(--mono)",
                  fontSize: 11,
                  color: "var(--text-faint)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  minWidth: 0,
                  flex: 1,
                }}
                title={dirPath}
              >
                {dirPath}
              </span>
            )}
            {dirty && (
              <span
                title="Unsaved changes"
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: "50%",
                  background: "var(--accent)",
                  flexShrink: 0,
                }}
              />
            )}
            {loaded?.kind === "text" && previewableTextFile && (
              <PreviewModeToggle mode={editorMode} onModeChange={setEditorMode} />
            )}
          </div>
        }
      >
        {externalChanged && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "8px 16px",
              background: "var(--surface-0)",
              borderBottom: "1px solid var(--border)",
              fontFamily: "var(--mono)",
              fontSize: 12,
              color: "var(--text-dim)",
            }}
          >
            <span style={{ flex: 1 }}>
              File changed on disk. {dirty ? "You have unsaved edits." : ""}
            </span>
            <Btn size="sm" variant="ghost" onClick={discardAndReload}>
              Discard mine & reload
            </Btn>
            <Btn size="sm" variant="ghost" onClick={() => doSave(true)}>
              Overwrite
            </Btn>
          </div>
        )}

        <div
          style={{
            flex: 1,
            minHeight: 0,
            // The markdown annotator manages its own two-column scrolling so the
            // comments rail stays pinned; every other view scrolls here.
            overflow: showMarkdownPreview ? "hidden" : "auto",
            background: showingRenderedPreview ? "var(--surface-0)" : "#282c34",
          }}
        >
          {loading ? (
            <Status>Loading…</Status>
          ) : loadError ? (
            <LoadErrorView
              kind={loadError.kind}
              lineCount={loadError.lineCount}
              onClose={requestClose}
            />
          ) : loaded?.kind === "image" ? (
            <ImagePreview src={loaded.dataUrl} fileName={fileName} />
          ) : showMarkdownPreview ? (
            <MarkdownAnnotator
              key={relPath ?? ""}
              content={content}
              fileName={fileName}
              onApplyRefined={persistRefined}
            />
          ) : showHtmlPreview ? (
            <HtmlPreview
              projectRoot={projectRoot}
              relPath={relPath ?? ""}
              source={content}
              fileName={fileName}
              reloadKey={loaded?.mtimeMs ?? 0}
              dirty={dirty}
            />
          ) : (
            <SafeCodeMirror
              cmRef={cmRef}
              fileName={relPath ?? fileName}
              value={content}
              onChange={setContent}
            />
          )}
        </div>

        {saveError && !externalChanged && (
          <div
            style={{
              padding: "6px 16px",
              fontFamily: "var(--mono)",
              fontSize: 11.5,
              color: "var(--status-failed)",
              background: "var(--surface-0)",
              borderTop: "1px solid var(--border)",
            }}
          >
            {saveError}
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={confirmClose}
        onClose={() => setConfirmClose(false)}
        onConfirm={() => {
          const exit = pendingExit;
          setConfirmClose(false);
          if (exit === "back" && onBack) onBack();
          else onClose();
        }}
        title="Discard unsaved changes?"
        confirmLabel="Discard"
        width={420}
      >
        <div style={{ fontSize: 12, color: "var(--text-dim)", lineHeight: 1.5 }}>
          You have unsaved edits. Leaving the editor will discard them.
        </div>
      </ConfirmDialog>
    </>
  );
}

/** Keeps CodeMirror language/extension failures inside the file dialog instead
 *  of bubbling to the app error boundary. Retries once as plain text. */
class CodeMirrorErrorBoundary extends Component<
  { children: ReactNode; onError: () => void },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.warn("[file-editor] CodeMirror failed; retrying as plain text:", error, info.componentStack);
    this.props.onError();
  }

  render(): ReactNode {
    if (this.state.failed) return null;
    return this.props.children;
  }
}

function SafeCodeMirror({
  cmRef,
  fileName,
  value,
  onChange,
}: {
  cmRef: RefObject<ReactCodeMirrorRef | null>;
  fileName: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const [plainTextOnly, setPlainTextOnly] = useState(false);
  const languageExtensions = plainTextOnly ? [] : languageForFilename(fileName);
  const extensions: Extension[] = [EditorView.lineWrapping, ...languageExtensions];

  return (
    <CodeMirrorErrorBoundary
      key={plainTextOnly ? "plain" : "lang"}
      onError={() => setPlainTextOnly(true)}
    >
      <CodeMirror
        ref={cmRef}
        value={value}
        theme={oneDark}
        extensions={extensions}
        onChange={onChange}
        basicSetup={{
          lineNumbers: true,
          highlightActiveLine: true,
          highlightActiveLineGutter: true,
          foldGutter: true,
        }}
        style={{ fontSize: 13, height: "100%" }}
      />
    </CodeMirrorErrorBoundary>
  );
}

function PreviewModeToggle({
  mode,
  onModeChange,
}: {
  mode: EditorMode;
  onModeChange: (mode: EditorMode) => void;
}) {
  return (
    <div
      role="group"
      aria-label="File view mode"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 2,
        padding: 2,
        border: "1px solid var(--border)",
        borderRadius: 5,
        background: "var(--surface-1)",
        flexShrink: 0,
        marginLeft: "auto",
      }}
    >
      <PreviewModeButton
        icon="pencil"
        label="Edit"
        active={mode === "edit"}
        onClick={() => onModeChange("edit")}
      />
      <PreviewModeButton
        icon="eye"
        label="Preview"
        active={mode === "preview"}
        onClick={() => onModeChange("preview")}
      />
    </div>
  );
}

function PreviewModeButton({
  icon,
  label,
  active,
  onClick,
}: {
  icon: "pencil" | "eye";
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
        height: 23,
        minWidth: 72,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 5,
        border: 0,
        borderRadius: 4,
        background: active ? "var(--surface-3)" : "transparent",
        color: active ? "var(--text)" : "var(--text-dim)",
        cursor: "pointer",
        padding: "0 8px",
        fontFamily: "var(--sans)",
        fontSize: 11,
        fontWeight: 500,
        whiteSpace: "nowrap",
      }}
    >
      <Icon name={icon} size={11} />
      {label}
    </button>
  );
}

function Status({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        padding: 24,
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

function ImagePreview({ src, fileName }: { src: string; fileName: string }) {
  return (
    <div
      style={{
        minHeight: "100%",
        padding: 24,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <img
        src={src}
        alt={fileName ? `Preview of ${fileName}` : "Image preview"}
        style={{
          maxWidth: "100%",
          maxHeight: "100%",
          objectFit: "contain",
          borderRadius: 8,
          boxShadow: "0 10px 36px rgba(0, 0, 0, 0.35)",
        }}
      />
    </div>
  );
}

function toLoadedFile(result: FileReadSuccess): LoadedFile {
  if (result.kind === "image") {
    return {
      kind: "image",
      dataUrl: result.dataUrl,
      mimeType: result.mimeType,
      size: result.size,
      mtimeMs: result.mtimeMs,
    };
  }
  return {
    kind: "text",
    content: result.content,
    mtimeMs: result.mtimeMs,
  };
}

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  const kb = size / 1024;
  if (kb < 1024) return `${kb.toFixed(kb >= 10 ? 0 : 1)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(mb >= 10 ? 0 : 1)} MB`;
}

const FILE_READ_MAX_LINES_LABEL = FILE_READ_MAX_LINES.toLocaleString();
const FILE_READ_MAX_BYTES_LABEL = formatBytes(FILE_READ_MAX_BYTES);

function LoadErrorView({
  kind,
  lineCount,
  onClose,
}: {
  kind: LoadError;
  lineCount?: number;
  onClose: () => void;
}) {
  let title = "Could not open file";
  let body = String(kind);
  if (kind === "too-large") {
    title = "File too large to open";
    body =
      lineCount && lineCount > 0
        ? `This file has ${lineCount.toLocaleString()} lines (limit is ${FILE_READ_MAX_LINES_LABEL}). If this is production code, consider splitting it up and decomposing it into smaller modules.`
        : `This file exceeds the ${FILE_READ_MAX_LINES_LABEL}-line / ${FILE_READ_MAX_BYTES_LABEL} limit. If this is production code, consider splitting it up and decomposing it into smaller modules.`;
  } else if (kind === "binary") {
    title = "Binary file";
    body = "This file appears to be binary and cannot be edited as text.";
  } else if (kind === "not-found") {
    title = "File not found";
    body = "The file no longer exists on disk.";
  } else if (kind === "invalid-path") {
    title = "Invalid file path";
    body = "This path is outside the project or cannot be opened safely.";
  }
  return (
    <div
      style={{
        padding: 32,
        fontFamily: "var(--mono)",
        fontSize: 13,
        color: "var(--text)",
        display: "flex",
        flexDirection: "column",
        gap: 12,
        alignItems: "flex-start",
      }}
    >
      <div style={{ fontWeight: 600 }}>{title}</div>
      <div style={{ color: "var(--text-dim)", fontSize: 12, lineHeight: 1.5 }}>{body}</div>
      <EscTooltip label="Close">
        <Btn variant="ghost" onClick={onClose}>
          Close
        </Btn>
      </EscTooltip>
    </div>
  );
}
