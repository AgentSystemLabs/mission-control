import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactCodeMirrorRef } from "@uiw/react-codemirror";
import { getRuntime } from "~/lib/runtime";
import type { LoadError } from "./load-error-view";

type LoadedFile = {
  content: string;
  mtimeMs: number;
};

export function useFileEditor({
  projectId,
  relPath,
  open,
  cmRef,
}: {
  projectId: string;
  relPath: string | null;
  open: boolean;
  cmRef: React.RefObject<ReactCodeMirrorRef | null>;
}) {
  const [loaded, setLoaded] = useState<LoadedFile | null>(null);
  const [content, setContent] = useState("");
  const [loadError, setLoadError] = useState<{ kind: LoadError; lineCount?: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [externalChanged, setExternalChanged] = useState(false);
  const watchIdRef = useRef<string | null>(null);
  const mtimeRef = useRef<number>(0);

  if (loaded) mtimeRef.current = loaded.mtimeMs;

  const dirty = loaded !== null && content !== loaded.content;
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;

  // Load on open / relPath change.
  useEffect(() => {
    const runtime = getRuntime();
    if (!open || !relPath || !runtime) return;
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    setLoaded(null);
    setContent("");
    setExternalChanged(false);
    setSaveError(null);
    void (async () => {
      try {
        const r = await runtime.files.read(projectId, relPath);
        if (cancelled) return;
        if (r.ok) {
          setLoaded({ content: r.content, mtimeMs: r.mtimeMs });
          setContent(r.content);
        } else {
          setLoadError({ kind: r.error, lineCount: r.lineCount });
        }
      } catch (err) {
        if (!cancelled) {
          setLoadError({ kind: err instanceof Error ? err.message : String(err) });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, projectId, relPath]);

  const handleExternalChange = useCallback(async () => {
    const runtime = getRuntime();
    if (!relPath || !runtime) return;
    const r = await runtime.files.read(projectId, relPath).catch((err) => {
      setSaveError(err instanceof Error ? err.message : String(err));
      return null;
    });
    if (!r) return;
    if (!r.ok) return;
    if (dirtyRef.current) {
      setLoaded((prev) => (prev ? { ...prev, mtimeMs: r.mtimeMs } : prev));
      setExternalChanged(true);
      return;
    }
    // Silent reload — preserve scroll + selection.
    const view = cmRef.current?.view;
    const scrollTop = view?.scrollDOM.scrollTop ?? 0;
    const selection = view?.state.selection;
    setLoaded({ content: r.content, mtimeMs: r.mtimeMs });
    setContent(r.content);
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
  }, [projectId, relPath, cmRef]);

  // Mount file watcher once per open file. The watcher fires on every external
  // mtime advance and we read the current mtime via ref, so saves don't tear it down.
  const hasLoaded = loaded !== null;
  useEffect(() => {
    const runtime = getRuntime();
    if (!open || !relPath || !hasLoaded || !runtime) return;
    let active = true;
    let unsub: (() => void) | undefined;
    void (async () => {
      const r = await runtime.files.watch(projectId, relPath).catch(() => null);
      if (!r) return;
      if (!active) {
        if (r.ok) void runtime.files.unwatch(r.watchId);
        return;
      }
      if (!r.ok) return;
      watchIdRef.current = r.watchId;
      unsub = runtime.files.onChanged((msg) => {
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
      if (id) void runtime.files.unwatch(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, projectId, relPath, hasLoaded]);

  const doSave = useCallback(
    async (forceOverwrite: boolean) => {
      const runtime = getRuntime();
      if (!relPath || !runtime || !loaded) return;
      setSaving(true);
      setSaveError(null);
      try {
        const r = await runtime.files.write(
          projectId,
          relPath,
          content,
          forceOverwrite ? null : loaded.mtimeMs,
        );
        if (r.ok) {
          setLoaded({ content, mtimeMs: r.mtimeMs });
          setExternalChanged(false);
          return;
        }
        if (r.error === "stale") {
          setExternalChanged(true);
          setSaveError("File changed on disk. Discard your edits and reload, or overwrite anyway.");
          return;
        }
        setSaveError(r.error);
      } catch (err) {
        setSaveError(err instanceof Error ? err.message : String(err));
      } finally {
        setSaving(false);
      }
    },
    [projectId, relPath, loaded, content],
  );

  const discardAndReload = useCallback(async () => {
    const runtime = getRuntime();
    if (!relPath || !runtime) return;
    const r = await runtime.files.read(projectId, relPath).catch((err) => {
      setSaveError(err instanceof Error ? err.message : String(err));
      return null;
    });
    if (!r) return;
    if (!r.ok) return;
    setLoaded({ content: r.content, mtimeMs: r.mtimeMs });
    setContent(r.content);
    setExternalChanged(false);
    setSaveError(null);
  }, [projectId, relPath]);

  return {
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
  };
}
