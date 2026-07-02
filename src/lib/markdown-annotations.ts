import {
  MARKDOWN_REFINE_QUOTE_MAX_LEN,
  type RefineAnnotationInput,
} from "~/shared/markdown-refine";

// Pure logic for the ephemeral markdown-annotation feature. No React, no DOM —
// so it stays unit-testable and the components stay thin. Annotations live only
// while the editor is open (the user chose ephemeral), so there is no
// persistence or anchor-rebasing here.

/** Where a comment is anchored: a 1-based source line range + a context snippet. */
export type AnnotationAnchor = {
  lineStart: number;
  lineEnd: number;
  quote: string;
};

export type AnnotationLineRange = Pick<AnnotationAnchor, "lineStart" | "lineEnd">;

export type Annotation = {
  id: string;
  anchor: AnnotationAnchor;
  note: string;
};

/**
 * Build an anchor for a block spanning `lineStart..lineEnd` (1-based, inclusive)
 * of `source`, deriving a trimmed quote snippet from those lines. Returns null
 * when the line range is unusable (e.g. react-markdown gave no position).
 */
export function buildAnchor(
  source: string,
  lineStart: number | undefined,
  lineEnd: number | undefined,
): AnnotationAnchor | null {
  if (!lineStart || lineStart < 1) return null;
  const end = lineEnd && lineEnd >= lineStart ? lineEnd : lineStart;
  return { lineStart, lineEnd: end, quote: quoteForLines(source, lineStart, end) };
}

function quoteForLines(source: string, start: number, end: number): string {
  const lines = source.split(/\r?\n/);
  const snippet = lines.slice(start - 1, end).join(" ").replace(/\s+/g, " ").trim();
  if (snippet.length <= MARKDOWN_REFINE_QUOTE_MAX_LEN) return snippet;
  // Reserve one char for the ellipsis so the result stays within the server's
  // MARKDOWN_REFINE_QUOTE_MAX_LEN cap (the endpoint 400s otherwise).
  return snippet.slice(0, MARKDOWN_REFINE_QUOTE_MAX_LEN - 1).trimEnd() + "…";
}

/** Append a fresh annotation for `anchor`. `id` is injected so this stays pure. */
export function addAnnotation(
  annotations: Annotation[],
  anchor: AnnotationAnchor,
  id: string,
): Annotation[] {
  return [...annotations, { id, anchor, note: "" }];
}

export function updateNote(annotations: Annotation[], id: string, note: string): Annotation[] {
  return annotations.map((a) => (a.id === id ? { ...a, note } : a));
}

export function removeAnnotation(annotations: Annotation[], id: string): Annotation[] {
  return annotations.filter((a) => a.id !== id);
}

/** Drop annotations whose note is blank — abandoned "+" clicks the user never filled in. */
export function dropEmpty(annotations: Annotation[]): Annotation[] {
  return annotations.filter((a) => a.note.trim().length > 0);
}

/** True when at least one annotation carries a non-blank note (Refine is meaningful). */
export function hasRefinable(annotations: Annotation[]): boolean {
  return annotations.some((a) => a.note.trim().length > 0);
}

/** Panel display order: top-to-bottom by anchor position, stable for ties. */
export function sortByAnchor(annotations: Annotation[]): Annotation[] {
  return [...annotations].sort((a, b) => {
    if (a.anchor.lineStart !== b.anchor.lineStart) return a.anchor.lineStart - b.anchor.lineStart;
    return a.anchor.lineEnd - b.anchor.lineEnd;
  });
}

export function rangesEqual(a: AnnotationLineRange, b: AnnotationLineRange): boolean {
  return a.lineStart === b.lineStart && a.lineEnd === b.lineEnd;
}

export function rangesOverlap(a: AnnotationLineRange, b: AnnotationLineRange): boolean {
  return a.lineStart <= b.lineEnd && b.lineStart <= a.lineEnd;
}

/** Find an existing annotation anchored to exactly the same source-line range. */
export function findByLineRange(
  annotations: Annotation[],
  range: AnnotationLineRange,
): Annotation | undefined {
  return annotations.find((a) => rangesEqual(a.anchor, range));
}

/** Find the first annotation whose range intersects the rendered block/selection. */
export function findByOverlappingRange(
  annotations: Annotation[],
  range: AnnotationLineRange,
): Annotation | undefined {
  return sortByAnchor(annotations).find((a) => rangesOverlap(a.anchor, range));
}

/** Convert the non-blank annotations into the wire shape the refine endpoint expects. */
export function toRefineInputs(annotations: Annotation[]): RefineAnnotationInput[] {
  return dropEmpty(sortByAnchor(annotations)).map((a) => ({
    lineStart: a.anchor.lineStart,
    lineEnd: a.anchor.lineEnd,
    quote: a.anchor.quote,
    note: a.note.trim(),
  }));
}
