import { useEffect, useMemo, useState } from "react";
import { buildHtmlPreviewSrcDoc, detectUnrenderableTemplate } from "~/lib/file-preview";
import { isSandboxRuntimeActive, startHtmlPreviewServer } from "~/lib/project-fs";

// Preview strategy:
//  - "server":      load the file over a loopback http server rooted at the
//                   file's own directory. Relative + root-absolute assets resolve
//                   and scripts run, like a browser. The iframe is cross-origin to
//                   the app (different port), so its scripts can't reach the app.
//  - "fallback":    inert sandboxed srcDoc — no disk, no scripts. Used for the
//                   Docker sandbox runtime (files live in the container).
//  - "unavailable": the preview-server IPC isn't present — the app is running an
//                   older main/preload and needs a full restart.
//  - "error":       the server failed to start; show why.
type Strategy =
  | { kind: "loading" }
  | { kind: "server"; port: number; fileName: string }
  | { kind: "fallback" }
  | { kind: "unavailable" }
  | { kind: "error"; message: string };

export function HtmlPreview({
  projectRoot,
  relPath,
  source,
  fileName,
  reloadKey,
  dirty,
}: {
  projectRoot: string;
  relPath: string;
  source: string;
  fileName: string;
  /** Bumps (e.g. on-disk mtime) to force the iframe to reload after a save. */
  reloadKey: number;
  /** The editor buffer has unsaved edits the on-disk preview won't reflect yet. */
  dirty: boolean;
}) {
  const [strategy, setStrategy] = useState<Strategy>({ kind: "loading" });

  // Serve the directory that contains the file, so it behaves like opening the
  // file in a browser from its own folder.
  const slash = relPath.lastIndexOf("/");
  const fileDir = slash >= 0 ? `${projectRoot}/${relPath.slice(0, slash)}` : projectRoot;
  const baseName = slash >= 0 ? relPath.slice(slash + 1) : relPath;

  useEffect(() => {
    let cancelled = false;
    setStrategy({ kind: "loading" });
    void (async () => {
      const api = window.electronAPI;
      // In Electron but without the preview bridge → the app is running older
      // process code; a renderer reload won't pick up main/preload changes.
      if (api && !api.preview) {
        if (!cancelled) setStrategy({ kind: "unavailable" });
        return;
      }
      // Files served from the container can't be reached by the host server.
      if (await isSandboxRuntimeActive()) {
        if (!cancelled) setStrategy({ kind: "fallback" });
        return;
      }
      const r = await startHtmlPreviewServer(fileDir);
      if (cancelled) return;
      setStrategy(
        r.ok
          ? { kind: "server", port: r.port, fileName: baseName }
          : { kind: "error", message: r.error },
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [fileDir, baseName]);

  const serverSrc =
    strategy.kind === "server"
      ? `http://127.0.0.1:${strategy.port}/${encodeURIComponent(strategy.fileName)}?mc=${reloadKey}`
      : null;

  const fallbackSrcDoc = useMemo(
    () => (strategy.kind === "fallback" ? buildHtmlPreviewSrcDoc(source) : ""),
    [strategy.kind, source],
  );

  const templateWarning = useMemo(() => detectUnrenderableTemplate(source), [source]);

  if (!source.trim()) return <HtmlPreviewNotice title="Empty HTML file" />;

  if (strategy.kind === "loading") {
    return <HtmlPreviewNotice title="Starting preview…" />;
  }

  if (strategy.kind === "unavailable") {
    return (
      <HtmlPreviewNotice
        title="Preview server not loaded"
        body="This preview needs app-process code that a reload can't pick up. Fully quit and restart Mission Control, then reopen the file."
      />
    );
  }

  if (strategy.kind === "error") {
    return (
      <HtmlPreviewNotice
        title="Couldn't start the preview server"
        body={strategy.message}
      />
    );
  }

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      {serverSrc ? (
        <iframe
          key={serverSrc}
          title={fileName ? `HTML preview of ${fileName}` : "HTML preview"}
          src={serverSrc}
          sandbox="allow-scripts allow-same-origin allow-forms"
          referrerPolicy="no-referrer"
          style={fillStyle}
        />
      ) : (
        <iframe
          title={fileName ? `HTML preview of ${fileName}` : "HTML preview"}
          srcDoc={fallbackSrcDoc}
          sandbox=""
          referrerPolicy="no-referrer"
          style={fillStyle}
        />
      )}
      {templateWarning && <TemplateBanner reason={templateWarning} />}
      {dirty && !templateWarning && <DirtyHint />}
    </div>
  );
}

const fillStyle = {
  width: "100%",
  height: "100%",
  display: "block",
  border: 0,
  background: "#fff",
} as const;

function TemplateBanner({ reason }: { reason: string }) {
  return (
    <div
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        display: "flex",
        alignItems: "flex-start",
        gap: 8,
        padding: "9px 14px",
        background: "color-mix(in srgb, var(--surface-2) 94%, transparent)",
        borderBottom: "1px solid var(--border)",
        color: "var(--text-dim)",
        fontFamily: "var(--sans)",
        fontSize: 11.5,
        lineHeight: 1.45,
        boxShadow: "0 4px 12px rgba(0,0,0,0.22)",
      }}
    >
      <span style={{ fontSize: 13, lineHeight: 1.1, flexShrink: 0 }}>⚠️</span>
      <span>
        <strong style={{ color: "var(--text)", fontWeight: 600 }}>
          Static preview can't fully render this file.
        </strong>{" "}
        {reason}
      </span>
    </div>
  );
}

function DirtyHint() {
  return (
    <div
      style={{
        position: "absolute",
        top: 10,
        right: 10,
        padding: "4px 9px",
        borderRadius: 999,
        background: "color-mix(in srgb, var(--surface-2) 88%, transparent)",
        border: "1px solid var(--border)",
        color: "var(--text-dim)",
        fontFamily: "var(--sans)",
        fontSize: 10.5,
        fontWeight: 500,
        pointerEvents: "none",
        boxShadow: "0 2px 8px rgba(0,0,0,0.28)",
      }}
    >
      Showing saved file · save to refresh
    </div>
  );
}

function HtmlPreviewNotice({ title, body }: { title: string; body?: string }) {
  return (
    <div
      style={{
        minHeight: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        padding: 32,
        textAlign: "center",
      }}
    >
      <div
        style={{
          fontFamily: "var(--mono)",
          fontSize: 12.5,
          fontWeight: 600,
          color: "var(--text)",
        }}
      >
        {title}
      </div>
      {body && (
        <div
          style={{
            maxWidth: 440,
            fontFamily: "var(--sans)",
            fontSize: 12,
            lineHeight: 1.5,
            color: "var(--text-dim)",
          }}
        >
          {body}
        </div>
      )}
    </div>
  );
}
