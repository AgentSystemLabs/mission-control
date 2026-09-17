import { describe, expect, it } from "vitest";
import {
  getPinnedProjects,
  mergeSubsetOrder,
  nextPinnedOrder,
  reorderPinnedIds,
  validatePinnedReorder,
  type PinnedOrderable,
} from "~/lib/pinned-project-order";

function project(
  overrides: Partial<PinnedOrderable> & Pick<PinnedOrderable, "id">,
): PinnedOrderable {
  return {
    pinned: false,
    pinnedOrder: null,
    createdAt: 1_000,
    ...overrides,
  };
}

describe("pinned-project-order", () => {
  it("sorts pinned projects by pinnedOrder then createdAt", () => {
    const projects = [
      project({ id: "c", pinned: true, pinnedOrder: 2, createdAt: 3_000 }),
      project({ id: "a", pinned: true, pinnedOrder: 0, createdAt: 1_000 }),
      project({ id: "b", pinned: true, pinnedOrder: 1, createdAt: 2_000 }),
      project({ id: "u", pinned: false }),
    ];
    expect(getPinnedProjects(projects).map((entry) => entry.id)).toEqual(["a", "b", "c"]);
  });

  it("falls back to createdAt when pinnedOrder is missing", () => {
    const projects = [
      project({ id: "old", pinned: true, pinnedOrder: null, createdAt: 1_000 }),
      project({ id: "new", pinned: true, pinnedOrder: null, createdAt: 2_000 }),
    ];
    expect(getPinnedProjects(projects).map((entry) => entry.id)).toEqual(["old", "new"]);
  });

  it("computes the next pinned order from existing pinned slots", () => {
    const projects = [
      project({ id: "a", pinned: true, pinnedOrder: 0 }),
      project({ id: "b", pinned: true, pinnedOrder: 4 }),
      project({ id: "c", pinned: false, pinnedOrder: 99 }),
    ];
    expect(nextPinnedOrder(projects)).toBe(5);
  });

  it("reorders ids within the pinned list", () => {
    expect(reorderPinnedIds(["a", "b", "c"], 0, 2)).toEqual(["b", "c", "a"]);
    expect(reorderPinnedIds(["a", "b", "c"], 2, 0)).toEqual(["c", "a", "b"]);
  });

  // Regression: with a group active, drags reorder only that group's pinned
  // subset — the merged result must stay a full-order permutation or the
  // server's validatePinnedReorder rejects the save.
  it("splices a reordered group subset back into the full pinned order", () => {
    // Global order interleaves two groups: g1 = [a, c], g2 = [b, d].
    expect(mergeSubsetOrder(["a", "b", "c", "d"], ["c", "a"])).toEqual(["c", "b", "a", "d"]);
    // Moving a tile to the end of its group's subset.
    expect(mergeSubsetOrder(["a", "b", "c", "d"], ["b", "d"])).toEqual(["a", "b", "c", "d"]);
    expect(mergeSubsetOrder(["a", "b", "c", "d"], ["d", "b"])).toEqual(["a", "d", "c", "b"]);
  });

  it("mergeSubsetOrder is identity for a full-order subset and ignores unknown ids", () => {
    expect(mergeSubsetOrder(["a", "b", "c"], ["c", "a", "b"])).toEqual(["c", "a", "b"]);
    expect(mergeSubsetOrder(["a", "b", "c"], [])).toEqual(["a", "b", "c"]);
    // A project unpinned mid-drag drops out instead of corrupting the order.
    expect(mergeSubsetOrder(["a", "b", "c"], ["gone", "c", "a"])).toEqual(["c", "b", "a"]);
  });

  it("mergeSubsetOrder output always validates as a complete reorder", () => {
    const pinned = [
      project({ id: "a", pinned: true, pinnedOrder: 0 }),
      project({ id: "b", pinned: true, pinnedOrder: 1 }),
      project({ id: "c", pinned: true, pinnedOrder: 2 }),
    ];
    const merged = mergeSubsetOrder(["a", "b", "c"], ["c", "a"]);
    expect(() => validatePinnedReorder(merged, pinned)).not.toThrow();
  });

  it("validates a complete pinned reorder payload", () => {
    const pinned = [
      project({ id: "a", pinned: true, pinnedOrder: 0 }),
      project({ id: "b", pinned: true, pinnedOrder: 1 }),
    ];
    expect(() => validatePinnedReorder(["a", "b"], pinned)).not.toThrow();
    expect(() => validatePinnedReorder(["b", "a"], pinned)).not.toThrow();
    expect(() => validatePinnedReorder(["a"], pinned)).toThrow(/exactly once/);
    expect(() => validatePinnedReorder(["a", "c"], pinned)).toThrow(/not pinned/);
    expect(() => validatePinnedReorder(["a", "a"], pinned)).toThrow(/duplicate/);
  });
});
