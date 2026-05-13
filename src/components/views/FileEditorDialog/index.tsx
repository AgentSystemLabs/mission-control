import { useCallback, useRef, useState } from "react";
import CodeMirror, { EditorView, type ReactCodeMirrorRef } from "@uiw/react-codemirror";
import { oneDark } from "@codemirror/theme-one-dark";
import { Modal } from "~/components/ui/Modal";
import { Btn } from "~/components/ui/Btn";
import { HotkeyTooltip, StaticHotkeyTooltip } from "~/components/ui/Tooltip";
import { ConfirmDialog } from "~/components/ui/ConfirmDialog";
import { useHotkey } from "~/lib/use-hotkey";
import { languageForFilename } from "~/lib/file-language";
import { LoadErrorView, Status } from "./load-error-view";
import { useFileEditor } from "./use-file-editor";

export function FileEditorDialog({
  projectId,
  relPath,
  onClose,
}: {
  projectId: string;
  relPath: string | null;
  onClose: () => void;
}) {
  const open = relPath !== null;
  const [confirmClose, setConfirmClose] = useState(false);
  const cmRef = useRef<ReactCodeMirrorRef>(null);

  const {
    loaded,
    content,
    setContent,
    loadError,
    loading,
    saving,
    saveError,
    externalChanged,
    dirty,
    dirtyRef,
    doSave,
    discardAndReload,
  } = useFileEditor({ projectId, relPath, open, cmRef });

  const slash = relPath ? relPath.lastIndexOf("/") : -1;
  const fileName = relPath ? (slash >= 0 ? relPath.slice(slash + 1) : relPath) : "";
  const dirPath = relPath && slash >= 0 ? relPath.slice(0, slash) : "";

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
  }, [onClose, dirtyRef]);

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
              {loaded ? `${content.length.toLocaleString()} chars` : ""}
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
