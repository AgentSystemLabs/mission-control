import { describe, expect, it } from "vitest";
import { SCRATCH_PAD_TITLE_MAX, scratchPadTitle } from "../scratch-pads";

describe("scratchPadTitle", () => {
  it("uses the first non-empty line, skipping leading blank/whitespace lines", () => {
    expect(scratchPadTitle("\n   \nreal title\nsecond line")).toBe("real title");
    expect(scratchPadTitle("  padded  \nrest")).toBe("padded");
  });

  it("falls back for empty or whitespace-only content", () => {
    expect(scratchPadTitle("")).toBe("Empty scratch pad");
    expect(scratchPadTitle("   \n\t\n  ")).toBe("Empty scratch pad");
  });

  it("passes a line of exactly the max length through unchanged", () => {
    const line = "a".repeat(SCRATCH_PAD_TITLE_MAX);
    expect(scratchPadTitle(line)).toBe(line);
  });

  it("truncates over-long lines to the max length ending in an ellipsis", () => {
    const line = "b".repeat(SCRATCH_PAD_TITLE_MAX + 1);
    const title = scratchPadTitle(line);
    expect(title).toHaveLength(SCRATCH_PAD_TITLE_MAX);
    expect(title.endsWith("…")).toBe(true);
    expect(title.startsWith("b".repeat(SCRATCH_PAD_TITLE_MAX - 1))).toBe(true);
  });
});
