import { describe, expect, it } from "vitest";
import {
  addAnnotation,
  buildAnchor,
  dropEmpty,
  findByLineRange,
  findByOverlappingRange,
  hasRefinable,
  rangesEqual,
  rangesOverlap,
  removeAnnotation,
  sortByAnchor,
  toRefineInputs,
  updateNote,
  type Annotation,
} from "../markdown-annotations";
import { MARKDOWN_REFINE_QUOTE_MAX_LEN } from "~/shared/markdown-refine";

const SOURCE = ["# Title", "", "First paragraph here.", "Second line of it.", "", "- item"].join("\n");

function annotation(overrides: Partial<Annotation> = {}): Annotation {
  return {
    id: "id-1",
    anchor: { lineStart: 3, lineEnd: 3, quote: "First paragraph here." },
    note: "",
    ...overrides,
  };
}

describe("buildAnchor", () => {
  it("builds an anchor with a trimmed, collapsed quote from the line range", () => {
    const anchor = buildAnchor(SOURCE, 3, 4);
    expect(anchor).toEqual({
      lineStart: 3,
      lineEnd: 4,
      quote: "First paragraph here. Second line of it.",
    });
  });

  it("defaults lineEnd to lineStart when missing or invalid", () => {
    expect(buildAnchor(SOURCE, 1, undefined)?.lineEnd).toBe(1);
    expect(buildAnchor(SOURCE, 3, 2)?.lineEnd).toBe(3);
  });

  it("returns null for an unusable line number", () => {
    expect(buildAnchor(SOURCE, 0, 0)).toBeNull();
    expect(buildAnchor(SOURCE, undefined, undefined)).toBeNull();
  });

  it("truncates a very long quote within the server's cap (including the ellipsis)", () => {
    // A run of non-space chars so truncation lands mid-"word" — the worst case
    // for the ellipsis pushing length over the cap.
    const long = "x".repeat(1000);
    const anchor = buildAnchor(long, 1, 1);
    expect(anchor).not.toBeNull();
    expect(anchor!.quote.endsWith("…")).toBe(true);
    expect(anchor!.quote.length).toBeLessThanOrEqual(MARKDOWN_REFINE_QUOTE_MAX_LEN);
  });
});

describe("annotation list operations", () => {
  it("adds, updates, and removes by id without mutating the input", () => {
    const anchor = buildAnchor(SOURCE, 3, 3)!;
    const empty: Annotation[] = [];
    const added = addAnnotation(empty, anchor, "id-1");
    expect(empty).toHaveLength(0);
    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({ id: "id-1", note: "" });

    const updated = updateNote(added, "id-1", "make it punchier");
    expect(updated[0]!.note).toBe("make it punchier");
    expect(added[0]!.note).toBe("");

    const removed = removeAnnotation(updated, "id-1");
    expect(removed).toHaveLength(0);
    expect(updated).toHaveLength(1);
  });

  it("finds annotations by exact or overlapping line ranges", () => {
    const list = [
      annotation({ id: "a", anchor: { lineStart: 3, lineEnd: 5, quote: "" } }),
      annotation({ id: "b", anchor: { lineStart: 9, lineEnd: 9, quote: "" } }),
    ];
    expect(findByLineRange(list, { lineStart: 3, lineEnd: 5 })?.id).toBe("a");
    expect(findByLineRange(list, { lineStart: 3, lineEnd: 3 })).toBeUndefined();
    expect(findByOverlappingRange(list, { lineStart: 4, lineEnd: 4 })?.id).toBe("a");
    expect(findByOverlappingRange(list, { lineStart: 6, lineEnd: 8 })).toBeUndefined();
  });
});

describe("line range helpers", () => {
  it("compares exact ranges and detects overlaps", () => {
    expect(rangesEqual({ lineStart: 2, lineEnd: 4 }, { lineStart: 2, lineEnd: 4 })).toBe(true);
    expect(rangesEqual({ lineStart: 2, lineEnd: 4 }, { lineStart: 2, lineEnd: 5 })).toBe(false);
    expect(rangesOverlap({ lineStart: 2, lineEnd: 4 }, { lineStart: 4, lineEnd: 6 })).toBe(true);
    expect(rangesOverlap({ lineStart: 2, lineEnd: 4 }, { lineStart: 5, lineEnd: 6 })).toBe(false);
  });
});

describe("dropEmpty / hasRefinable", () => {
  it("drops whitespace-only notes and reports refinability", () => {
    const list = [
      annotation({ id: "a", note: "real note" }),
      annotation({ id: "b", note: "   " }),
      annotation({ id: "c", note: "" }),
    ];
    expect(dropEmpty(list).map((a) => a.id)).toEqual(["a"]);
    expect(hasRefinable(list)).toBe(true);
    expect(hasRefinable([annotation({ note: "  " })])).toBe(false);
  });
});

describe("sortByAnchor", () => {
  it("orders by lineStart then lineEnd", () => {
    const list = [
      annotation({ id: "late", anchor: { lineStart: 10, lineEnd: 10, quote: "" } }),
      annotation({ id: "early", anchor: { lineStart: 2, lineEnd: 5, quote: "" } }),
      annotation({ id: "mid", anchor: { lineStart: 2, lineEnd: 2, quote: "" } }),
    ];
    expect(sortByAnchor(list).map((a) => a.id)).toEqual(["mid", "early", "late"]);
  });
});

describe("toRefineInputs", () => {
  it("returns sorted, trimmed, non-empty inputs in wire shape", () => {
    const list = [
      annotation({ id: "b", anchor: { lineStart: 8, lineEnd: 9, quote: "q2" }, note: "  add example  " }),
      annotation({ id: "a", anchor: { lineStart: 3, lineEnd: 3, quote: "q1" }, note: "shorten" }),
      annotation({ id: "empty", anchor: { lineStart: 1, lineEnd: 1, quote: "" }, note: "  " }),
    ];
    expect(toRefineInputs(list)).toEqual([
      { lineStart: 3, lineEnd: 3, quote: "q1", note: "shorten" },
      { lineStart: 8, lineEnd: 9, quote: "q2", note: "add example" },
    ]);
  });
});
