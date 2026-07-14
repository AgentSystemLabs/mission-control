import { describe, expect, it } from "vitest";
import type { Group } from "~/db/schema";
import {
  clusterPinnedByGroup,
  type RailProject,
} from "~/lib/rail-projects";

function group(id: string, name: string): Group {
  return {
    id,
    name,
    color: "#888888",
    sortOrder: null,
    createdAt: 1_000,
  };
}

function project(
  id: string,
  groupId: string | null,
  pinnedOrder: number,
): RailProject {
  return {
    id,
    name: id,
    groupId,
    pinned: true,
    pinnedOrder,
    createdAt: 1_000 + pinnedOrder,
  };
}

describe("clusterPinnedByGroup", () => {
  it("keeps empty groups in group order so their rail headers remain drop targets", () => {
    const clusters = clusterPinnedByGroup(
      [project("alpha-project", "alpha", 0), project("loose-project", null, 1)],
      [group("alpha", "Alpha"), group("empty", "Empty"), group("omega", "Omega")],
    );

    expect(clusters.map(({ key, projects }) => [key, projects.map((entry) => entry.id)])).toEqual([
      ["alpha", ["alpha-project"]],
      ["empty", []],
      ["omega", []],
      ["ungrouped", ["loose-project"]],
    ]);
  });

  it("does not add an empty synthetic Ungrouped cluster", () => {
    const clusters = clusterPinnedByGroup([], [group("empty", "Empty")]);

    expect(clusters.map((cluster) => cluster.key)).toEqual(["empty"]);
  });
});
