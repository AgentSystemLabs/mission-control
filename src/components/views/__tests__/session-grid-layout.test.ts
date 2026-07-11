import { describe, expect, it } from "vitest";
import {
  chunkIntoRows,
  pourIdsIntoShape,
  reconcileLayout,
  reflowToColumns,
  sortIdsByAgentFirst,
} from "../SessionGrid";

/** Cell ids per row — the part of a layout these tests assert on. */
function rowsOf(layout: { rows: Array<{ cells: string[] }> }): string[][] {
  return layout.rows.map((r) => r.cells);
}

const NO_PLACEMENT = { cloneAfter: null, newRow: false, anchor: null };

describe("chunkIntoRows", () => {
  it("seeds a near-square shape without a cap", () => {
    expect(rowsOf(chunkIntoRows(["a", "b", "c", "d", "e"]))).toEqual([
      ["a", "b", "c"],
      ["d", "e"],
    ]);
  });

  it("uses the locked width when a cap is set", () => {
    expect(rowsOf(chunkIntoRows(["a", "b", "c", "d", "e"], 2))).toEqual([
      ["a", "b"],
      ["c", "d"],
      ["e"],
    ]);
  });
});

describe("reflowToColumns", () => {
  it("re-chunks the current reading order into the picked width", () => {
    const layout = {
      rows: [
        { cells: ["a", "b", "c"], colSizes: [1, 2, 1] },
        { cells: ["d"], colSizes: [1] },
      ],
      rowSizes: [2, 1],
    };
    const next = reflowToColumns(layout, 2);
    expect(rowsOf(next)).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
    // A new shape means the old track weights no longer apply — equal tracks.
    expect(next.rows.every((r) => r.colSizes.every((s) => s === 1))).toBe(true);
    expect(next.rowSizes).toEqual([1, 1]);
  });
});

describe("pourIdsIntoShape", () => {
  it("reorders occupants while keeping the shape and sizes", () => {
    const layout = {
      rows: [
        { cells: ["a", "b"], colSizes: [1, 3] },
        { cells: ["c"], colSizes: [1] },
      ],
      rowSizes: [1, 2],
    };
    const next = pourIdsIntoShape(layout, ["c", "a", "b"]);
    expect(rowsOf(next)).toEqual([["c", "a"], ["b"]]);
    expect(next.rows.map((r) => r.colSizes)).toEqual([[1, 3], [1]]);
    expect(next.rowSizes).toEqual([1, 2]);
  });

  it("ignores unknown ids and keeps missing ones in place at the end", () => {
    const layout = {
      rows: [{ cells: ["a", "b", "c"], colSizes: [1, 1, 1] }],
      rowSizes: [1],
    };
    expect(rowsOf(pourIdsIntoShape(layout, ["b", "ghost"]))).toEqual([["b", "a", "c"]]);
  });
});

describe("sortIdsByAgentFirst", () => {
  const cells = [
    { id: "s1", agent: "codex" },
    { id: "s2", agent: "claude-code" },
    { id: "s3", agent: "opencode" },
    { id: "s4", agent: "claude-code" },
    { id: "s5", agent: "codex" },
  ];
  const order = ["claude-code", "codex", "cursor-cli", "opencode"];

  it("puts the chosen agent first, then registry order, stably", () => {
    expect(sortIdsByAgentFirst(cells, "codex", order)).toEqual([
      "s1",
      "s5",
      "s2",
      "s4",
      "s3",
    ]);
    expect(sortIdsByAgentFirst(cells, "opencode", order)).toEqual([
      "s3",
      "s2",
      "s4",
      "s1",
      "s5",
    ]);
  });

  it("ranks unknown agents last without dropping them", () => {
    expect(
      sortIdsByAgentFirst([{ id: "x", agent: "mystery" }, ...cells], "claude-code", order),
    ).toEqual(["s2", "s4", "s1", "s5", "s3", "x"]);
  });
});

describe("reconcileLayout with a sessions-per-row lock", () => {
  it("fills the anchor row up to the cap, then the next row with space", () => {
    const base = {
      rows: [
        { cells: ["a", "b"], colSizes: [1, 1] },
        { cells: ["c"], colSizes: [1] },
      ],
      rowSizes: [1, 1],
    };
    // Anchor sits in the full first row: the new session flows to row 2.
    const next = reconcileLayout(base, ["a", "b", "c", "n1"], [], {
      ...NO_PLACEMENT,
      anchor: "a",
      maxPerRow: 2,
    });
    expect(rowsOf(next)).toEqual([
      ["a", "b"],
      ["c", "n1"],
    ]);
  });

  it("opens a fresh row when every row from the anchor down is full", () => {
    const base = {
      rows: [{ cells: ["a", "b"], colSizes: [1, 1] }],
      rowSizes: [1],
    };
    const next = reconcileLayout(base, ["a", "b", "n1", "n2", "n3"], [], {
      ...NO_PLACEMENT,
      anchor: "b",
      maxPerRow: 2,
    });
    expect(rowsOf(next)).toEqual([
      ["a", "b"],
      ["n1", "n2"],
      ["n3"],
    ]);
    expect(next.rowSizes).toEqual([1, 1, 1]);
  });

  it("keeps clone-beside-source while the source row has room", () => {
    const base = {
      rows: [{ cells: ["a", "b"], colSizes: [1, 1] }],
      rowSizes: [1],
    };
    const next = reconcileLayout(base, ["a", "b", "n1"], [], {
      ...NO_PLACEMENT,
      cloneAfter: "a",
      maxPerRow: 3,
    });
    expect(rowsOf(next)).toEqual([["a", "n1", "b"]]);
  });

  it("reroutes a clone whose source row is full to the next row", () => {
    const base = {
      rows: [
        { cells: ["a", "b"], colSizes: [1, 1] },
        { cells: ["c"], colSizes: [1] },
      ],
      rowSizes: [1, 1],
    };
    const next = reconcileLayout(base, ["a", "b", "c", "n1"], [], {
      ...NO_PLACEMENT,
      cloneAfter: "a",
      maxPerRow: 2,
    });
    expect(rowsOf(next)).toEqual([
      ["a", "b"],
      ["c", "n1"],
    ]);
  });

  it("wraps a new-row batch wider than the cap into further rows", () => {
    const base = {
      rows: [{ cells: ["a"], colSizes: [1] }],
      rowSizes: [1],
    };
    const next = reconcileLayout(base, ["a", "n1", "n2", "n3"], [], {
      ...NO_PLACEMENT,
      newRow: true,
      maxPerRow: 2,
    });
    expect(rowsOf(next)).toEqual([["a"], ["n1", "n2"], ["n3"]]);
  });

  it("keeps legacy append behavior without a cap", () => {
    const base = {
      rows: [{ cells: ["a", "b"], colSizes: [1, 1] }],
      rowSizes: [1],
    };
    const next = reconcileLayout(base, ["a", "b", "n1"], [], {
      ...NO_PLACEMENT,
      anchor: "a",
    });
    expect(rowsOf(next)).toEqual([["a", "b", "n1"]]);
  });
});
