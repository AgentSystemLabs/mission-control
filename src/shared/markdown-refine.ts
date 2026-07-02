import type { AiModelId, AiRuntimeHarness } from "./ai-runtime-defaults";

// Shared contract for the markdown "Refine" flow: the annotation preview in the
// renderer (FileEditorDialog → MarkdownAnnotator) POSTs these to
// `/api/markdown/refine`, and the server (markdown.controller → markdown-refiner)
// validates + fulfills them. Keep this the single source of truth so the two
// sides can't drift.

/** Hard cap on the markdown payload sent for refinement (~200 KB). */
export const MARKDOWN_REFINE_MAX_BYTES = 200_000;
/** A single Refine request may carry at most this many annotations. */
export const MARKDOWN_REFINE_MAX_ANNOTATIONS = 100;
/** Per-comment note length ceiling. */
export const MARKDOWN_REFINE_NOTE_MAX_LEN = 2_000;
/** Anchor-quote snippet length ceiling. */
export const MARKDOWN_REFINE_QUOTE_MAX_LEN = 400;

/** One reviewer comment anchored to a source-line range in the original doc. */
export type RefineAnnotationInput = {
  lineStart: number;
  lineEnd: number;
  /** Short snippet of the anchored block, for the model's context. */
  quote: string;
  /** The reviewer's requested change. */
  note: string;
};

export type MarkdownRefineRequest = {
  content: string;
  /** Which agent CLI should perform the one-shot rewrite. */
  harness: AiRuntimeHarness;
  /** `null` → let the CLI use its own default model. */
  model: AiModelId | null;
  annotations: RefineAnnotationInput[];
};

export type MarkdownRefineResponse = { refined: string };
