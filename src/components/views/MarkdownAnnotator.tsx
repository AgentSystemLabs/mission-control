import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Icon } from "~/components/ui/Icon";
import {
  MarkdownAnnotationContext,
  MarkdownPreview,
  type MarkdownAnnotationApi,
} from "~/components/views/MarkdownPreview";
import { AnnotationsPanel } from "~/components/views/AnnotationsPanel";
import { api } from "~/lib/api";
import { mcToastLoading } from "~/lib/mc-toast";
import {
  addAnnotation,
  buildAnchor,
  findByLineRange,
  findByOverlappingRange,
  hasRefinable,
  removeAnnotation,
  sortByAnchor,
  toRefineInputs,
  updateNote,
  type Annotation,
  type AnnotationLineRange,
} from "~/lib/markdown-annotations";
import { useSettings } from "~/queries";
import { AGENT_REGISTRY } from "~/shared/agents";
import type { AiRuntimeHarness } from "~/shared/ai-runtime-defaults";
import { MARKDOWN_REFINE_MAX_ANNOTATIONS } from "~/shared/markdown-refine";

function newId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  return `a-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;
}

/**
 * Annotation-enabled markdown preview. Wraps `MarkdownPreview` with an in-memory
 * comment layer (Google-Docs style) and a "Refine" action that rewrites the file
 * and saves it straight to disk via the annotation model. Annotations are
 * ephemeral — they live only while this component is mounted.
 */
export function MarkdownAnnotator({
  content,
  fileName,
  onApplyRefined,
}: {
  content: string;
  fileName: string;
  /** Persist the model's rewrite to disk. Rejects if the write fails. */
  onApplyRefined: (refined: string) => Promise<void>;
}) {
  const { data: settings } = useSettings();
  const annotationAgent = settings?.annotationAgent ?? "claude-code";
  const annotationModel = settings?.annotationModel ?? null;
  const modelLabel = runtimeModelLabel(annotationAgent, annotationModel);

  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [autoFocusId, setAutoFocusId] = useState<string | null>(null);
  const [refining, setRefining] = useState(false);

  // A refine can take up to ~2 minutes and now saves to disk itself (see
  // handleRefine), so it deliberately runs to completion even if the dialog
  // closes or switches files mid-flight. mountedRef only gates the post-refine
  // setState (annotation reset / spinner) so we don't touch an unmounted tree;
  // the disk write is not conditional on it.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Synchronous re-entry guard for Refine, without adding a dep that would
  // rebuild the annotation context every keystroke.
  const refiningRef = useRef(false);

  const annotatedRanges = useMemo(
    () => annotations.map((a) => ({ lineStart: a.anchor.lineStart, lineEnd: a.anchor.lineEnd })),
    [annotations],
  );
  const activeRange = useMemo(() => {
    const active = annotations.find((a) => a.id === activeId);
    return active ? { lineStart: active.anchor.lineStart, lineEnd: active.anchor.lineEnd } : null;
  }, [annotations, activeId]);

  // Latest annotations for event handlers that must read fresh state without
  // taking `annotations` as a dependency (which would re-create the context and
  // re-render the whole preview on every keystroke). setState updaters below
  // stay pure — no nested setState — so they're safe under StrictMode.
  const annotationsRef = useRef(annotations);
  annotationsRef.current = annotations;

  const handleAdd = useCallback(
    (anchor: AnnotationLineRange) => {
      // Preview affordance stays live during a refine; ignore it so a comment
      // added mid-flight can't be silently wiped when the rewrite lands.
      if (refiningRef.current) return;
      const current = annotationsRef.current;
      const existing = findByLineRange(current, anchor);
      if (existing) {
        setActiveId(existing.id);
        setAutoFocusId(existing.id);
        return;
      }
      if (current.length >= MARKDOWN_REFINE_MAX_ANNOTATIONS) {
        toast.error(`You can add at most ${MARKDOWN_REFINE_MAX_ANNOTATIONS} comments per refine.`);
        return;
      }
      const built = buildAnchor(content, anchor.lineStart, anchor.lineEnd);
      if (!built) return;
      const id = newId();
      setAnnotations((prev) => addAnnotation(prev, built, id));
      setActiveId(id);
      setAutoFocusId(id);
    },
    [content],
  );

  const handleSelectRange = useCallback((range: AnnotationLineRange) => {
    if (refiningRef.current) return;
    const match = findByOverlappingRange(annotationsRef.current, range);
    if (match) setActiveId(match.id);
  }, []);

  const handleChangeNote = useCallback((id: string, note: string) => {
    setAnnotations((prev) => updateNote(prev, id, note));
  }, []);

  const handleRemove = useCallback((id: string) => {
    setAnnotations((prev) => removeAnnotation(prev, id));
    setActiveId((cur) => (cur === id ? null : cur));
    setAutoFocusId((cur) => (cur === id ? null : cur));
  }, []);

  const handleBlurEmpty = useCallback((id: string) => {
    const target = annotationsRef.current.find((a) => a.id === id);
    if (!target || target.note.trim()) return;
    setAnnotations((prev) => removeAnnotation(prev, id));
    setActiveId((cur) => (cur === id ? null : cur));
    setAutoFocusId((cur) => (cur === id ? null : cur));
  }, []);

  const handleRefine = useCallback(async () => {
    const inputs = toRefineInputs(annotations);
    // Synchronous ref guard closes the pre-commit double-click window that the
    // disabled button alone leaves open.
    if (inputs.length === 0 || refiningRef.current) return;
    refiningRef.current = true;
    setRefining(true);
    const toastId = mcToastLoading("Refining markdown…");
    try {
      const { refined } = await api.refineMarkdown({
        content,
        harness: annotationAgent,
        model: annotationModel,
        annotations: inputs,
      });
      // Persist straight to disk. This runs to completion even if the dialog was
      // closed or switched files mid-refine — the promise floats free of this
      // component's lifecycle — so the user can kick off a refine, close the
      // panel, and find the saved rewrite on disk when they reopen it. The write
      // targets the file this refine was started against (captured in the
      // onApplyRefined closure), so a reused dialog can't be clobbered.
      await onApplyRefined(refined);
      toast.dismiss(toastId);
      toast.success("Markdown refined and saved");
      if (mountedRef.current) {
        setAnnotations([]);
        setActiveId(null);
        setAutoFocusId(null);
      }
    } catch (e) {
      toast.dismiss(toastId);
      toast.error(e instanceof Error ? e.message : "Refine failed");
    } finally {
      refiningRef.current = false;
      if (mountedRef.current) setRefining(false);
    }
  }, [annotations, content, annotationAgent, annotationModel, onApplyRefined]);

  const ctx: MarkdownAnnotationApi = useMemo(
    () => ({
      annotatedRanges,
      activeRange,
      onAdd: handleAdd,
      onSelect: handleSelectRange,
    }),
    [annotatedRanges, activeRange, handleAdd, handleSelectRange],
  );

  const sorted = useMemo(() => sortByAnchor(annotations), [annotations]);
  const hasAnnotations = annotations.length > 0;

  return (
    <div style={{ height: "100%", display: "flex", minHeight: 0 }}>
      <div
        style={{
          flex: 1,
          minWidth: 0,
          display: "flex",
          flexDirection: "column",
          minHeight: 0,
        }}
      >
        {refining && <RefiningBar />}
        {!hasAnnotations && !refining && <HintBar />}
        <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
          <MarkdownAnnotationContext.Provider value={ctx}>
            <MarkdownPreview source={content} fileName={fileName} />
          </MarkdownAnnotationContext.Provider>
        </div>
      </div>

      {hasAnnotations && (
        <AnnotationsPanel
          annotations={sorted}
          activeId={activeId}
          autoFocusId={autoFocusId}
          onAutoFocused={() => setAutoFocusId(null)}
          refining={refining}
          canRefine={hasRefinable(annotations) && !refining}
          modelLabel={modelLabel}
          onSelect={setActiveId}
          onChangeNote={handleChangeNote}
          onRemove={handleRemove}
          onBlurEmpty={handleBlurEmpty}
          onRefine={() => void handleRefine()}
        />
      )}
    </div>
  );
}

function runtimeModelLabel(agent: AiRuntimeHarness, model: string | null): string {
  const harness = AGENT_REGISTRY[agent].label;
  return model ? `${harness} (${model})` : `${harness}'s default model`;
}

function RefiningBar() {
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "7px 16px",
        borderBottom: "1px solid var(--border)",
        background: "var(--surface-0)",
        fontFamily: "var(--mono)",
        fontSize: 11.5,
        color: "var(--text-dim)",
      }}
    >
      <span style={{ display: "inline-flex", animation: "spin 0.8s linear infinite" }}>
        <Icon name="refresh" size={12} />
      </span>
      Refining markdown…
    </div>
  );
}

function HintBar() {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "6px 16px",
        borderBottom: "1px solid var(--border)",
        background: "var(--surface-0)",
        fontFamily: "var(--sans)",
        fontSize: 11.5,
        color: "var(--text-faint)",
      }}
    >
      <Icon name="sparkles" size={12} />
      Hover a section or select text and click
      <span
        aria-hidden
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 16,
          height: 16,
          borderRadius: 4,
          border: "1px solid var(--border)",
          color: "var(--text-dim)",
        }}
      >
        <Icon name="plus" size={10} />
      </span>
      to leave a comment, then Refine with AI.
    </div>
  );
}
