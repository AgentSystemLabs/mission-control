import { useCallback, useEffect, useRef, useState } from "react";
import CodeMirror, { EditorView, type ReactCodeMirrorRef } from "@uiw/react-codemirror";
import { oneDark } from "@codemirror/theme-one-dark";
import { Modal } from "~/components/ui/Modal";
import { Btn } from "~/components/ui/Btn";
import { HotkeyTooltip, StaticHotkeyTooltip, EscTooltip } from "~/components/ui/Tooltip";
import { ConfirmDialog } from "~/components/ui/ConfirmDialog";
import { useHotkey } from "~/lib/use-hotkey";
import { languageForFilename } from "~/lib/file-language";
import type { FileReadError, FileReadResult } from "~/shared/electron-contract";

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

export function FileEditorDialog({
  projectRoot,
  relPath,
  onClose,
}: {
  projectRoot: string;
  relPath: string | null;
  onClose: () => void;
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
  const watchIdRef = useRef<string | null>(null);
  const mtimeRef = useRef<number>(0);
  const cmRef = useRef<ReactCodeMirrorRef>(null);

  if (loaded) mtimeRef.current = loaded.mtimeMs;

  const dirty = loaded?.kind === "text" && content !== loaded.content;
  const slash = relPath ? relPath.lastIndexOf("/") : -1;
  const fileName = relPath ? (slash >= 0 ? relPath.slice(slash + 1) : relPath) : "";
  const dirPath = relPath && slash >= 0 ? relPath.slice(0, slash) : "";

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
      const r = await window.electronAPI!.files.read(projectRoot, relPath);
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

  // Mount file watcher once per open file. The watcher fires on every external
  // mtime advance and we read the current mtime via ref, so saves don't tear it down.
  const hasLoaded = loaded !== null;
  useEffect(() => {
    if (!open || !relPath || !hasLoaded || !window.electronAPI) return;
    let active = true;
    let unsub: (() => void) | undefined;
    void (async () => {
      const r = await window.electronAPI!.files.watch(projectRoot, relPath);
      if (!active) {
        if (r.ok) void window.electronAPI!.files.unwatch(r.watchId);
        return;
      }
      if (!r.ok) return;
      watchIdRef.current = r.watchId;
      unsub = window.electronAPI!.files.onChanged((msg) => {
        if (msg.watchId !== r.watchId) return;
        if (msg.mtimeMs <= mtimeRef.current) return;
        void handleExternalChange();
      });
    })();
    return () => {
      active = false;
      unsub?.();
      const id = watchIdRef.current;
      watchIdRef.current = null;
      if (id) void window.electronAPI?.files.unwatch(id);
    };
  }, [open, projectRoot, relPath, hasLoaded]);

  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;

  const handleExternalChange = useCallback(async () => {
    if (!relPath || !window.electronAPI) return;
    const r = await window.electronAPI.files.read(projectRoot, relPath);
    if (!r.ok) return;
    const next = toLoadedFile(r);
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
    async (forceOverwrite: boolean) => {
      if (!relPath || !window.electronAPI || !loaded) return;
      if (loaded.kind !== "text") return;
      setSaving(true);
      setSaveError(null);
      const expectedMtime = forceOverwrite ? null : loaded.mtimeMs;
      let r = await window.electronAPI.files.write(
        projectRoot,
        relPath,
        content,
        expectedMtime,
      );
      // Sensitive paths (.claude/settings.local.json, .git/hooks/*, package.json,
      // .vscode/tasks.json, etc.) are rejected by `files:write` and must go
      // through `files:writeSensitive`, which surfaces a native OS confirm
      // dialog in the main process. The retry is silent — the user sees one
      // dialog, not an error followed by a re-click.
      if (!r.ok && r.error === "protected-path") {
        r = await window.electronAPI.files.writeSensitive(
          projectRoot,
          relPath,
          content,
          expectedMtime,
        );
      }
      setSaving(false);
      if (r.ok) {
        setLoaded({ kind: "text", content, mtimeMs: r.mtimeMs });
        setExternalChanged(false);
        return;
      }
      if (r.error === "stale") {
        setExternalChanged(true);
        setSaveError("File changed on disk. Discard your edits and reload, or overwrite anyway.");
        return;
      }
      // User clicked Cancel in the native confirm dialog — no-op, not an error.
      if (r.error === "user-declined") {
        return;
      }
      setSaveError(r.error);
    },
    [projectRoot, relPath, loaded, content],
  );

  const discardAndReload = useCallback(async () => {
    if (!relPath || !window.electronAPI) return;
    const r = await window.electronAPI.files.read(projectRoot, relPath);
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
      setConfirmClose(true);
      return;
    }
    onClose();
  }, [onClose]);

  if (!open) return null;

  const extensions = [
    EditorView.lineWrapping,
    ...(relPath ? languageForFilename(relPath) : []),
  ];

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
            <HotkeyTooltip action="file.save">
              <Btn
                variant="primary"
                icon="check"
                onClick={() => doSave(false)}
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
            }}
          >
            <span
              style={{
                fontFamily: "var(--mono)",
                fontSize: 12.5,
                fontWeight: 600,
                color: "var(--text)",
                flexShrink: 0,
              }}
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

        <div style={{ flex: 1, minHeight: 0, overflow: "auto", background: "#282c34" }}>
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
          ) : (
            <CodeMirror
              ref={cmRef}
              value={content}
              theme={oneDark}
              extensions={extensions}
              onChange={(v) => setContent(v)}
              basicSetup={{
                lineNumbers: true,
                highlightActiveLine: true,
                highlightActiveLineGutter: true,
                foldGutter: true,
              }}
              style={{ fontSize: 13, height: "100%" }}
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
          setConfirmClose(false);
          onClose();
        }}
        title="Discard unsaved changes?"
        confirmLabel="Discard"
        width={420}
      >
        <div style={{ fontSize: 12, color: "var(--text-dim)", lineHeight: 1.5 }}>
          You have unsaved edits. Closing the editor will discard them.
        </div>
      </ConfirmDialog>
    </>
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
        ? `This file has ${lineCount.toLocaleString()} lines (limit is 1,000). If this is production code, consider splitting it up and decomposing it into smaller modules.`
        : "This file exceeds the 1,000-line / 5 MB limit. If this is production code, consider splitting it up and decomposing it into smaller modules.";
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
