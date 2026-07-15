import { describe, expect, it } from "vitest";
import type { Group } from "~/db/schema";
import {
  DEFAULT_PROJECT_SORT,
  sortProjects,
  toggleProjectSort,
  type ProjectSortState,
} from "~/lib/sort-projects";
import type { ProjectWithCounts } from "~/shared/projects";

const groups: Group[] = [
  { id: "g-alpha", name: "Alpha", color: "#ff0000", sortOrder: 0, createdAt: 1 },
  { id: "g-beta", name: "Beta", color: "#00ff00", sortOrder: 1, createdAt: 2 },
];

function makeProject(
  overrides: Partial<ProjectWithCounts> & Pick<ProjectWithCounts, "id" | "name">,
): ProjectWithCounts {
  return {
    path: `/tmp/${overrides.id}`,
    icon: "folder",
    iconColor: "#ffffff",
    imagePath: null,
    groupId: null,
    sandboxId: null,
    pinned: false,
    pinnedOrder: null,
    branch: "main",
    launchCommands: null,
    customScripts: null,
    launchUrl: null,
    worktreeSetupCommand: null,
    rememberAgentSettings: false,
    savedAgent: null,
    savedSkipPermissions: false,
    savedBareSession: false,
    defaultGridView: false,
    createdAt: 1_000,
    updatedAt: 1_000,
    taskCounts: {
      ready: 0,
      running: 0,
      "needs-input": 0,
      interrupted: 0,
      finished: 0,
      terminated: 0,
      disconnected: 0,
      total: 0,
      activeNonDone: 0,
    },
    ...overrides,
  };
}

const projects = [
  makeProject({
    id: "p-zulu",
    name: "Zulu",
    groupId: "g-beta",
    createdAt: 3_000,
    updatedAt: 9_000,
    taskCounts: {
      ready: 0,
      running: 2,
      "needs-input": 0,
      interrupted: 0,
      finished: 0,
      terminated: 0,
      disconnected: 0,
      total: 2,
      activeNonDone: 2,
    },
  }),
  makeProject({
    id: "p-alpha",
    name: "Alpha",
    groupId: "g-alpha",
    createdAt: 1_000,
    updatedAt: 5_000,
  }),
  makeProject({
    id: "p-bravo",
    name: "Bravo",
    createdAt: 2_000,
    updatedAt: 7_000,
    taskCounts: {
      ready: 0,
      running: 0,
      "needs-input": 1,
      interrupted: 0,
      finished: 0,
      terminated: 0,
      disconnected: 0,
      total: 1,
      activeNonDone: 1,
    },
  }),
];

describe("sortProjects", () => {
  it("sorts by name ascending", () => {
    const sort: ProjectSortState = { column: "name", direction: "asc" };
    expect(sortProjects(projects, groups, sort, new Set()).map((p) => p.name)).toEqual([
      "Alpha",
      "Bravo",
      "Zulu",
    ]);
  });

  it("sorts by last edit descending by default helper", () => {
    expect(
      sortProjects(projects, groups, DEFAULT_PROJECT_SORT, new Set()).map((p) => p.id),
    ).toEqual(["p-zulu", "p-bravo", "p-alpha"]);
  });

  it("sorts by group name", () => {
    const sort: ProjectSortState = { column: "group", direction: "asc" };
    expect(sortProjects(projects, groups, sort, new Set()).map((p) => p.name)).toEqual([
      "Alpha",
      "Zulu",
      "Bravo",
    ]);
  });

  it("sorts by running task count", () => {
    const sort: ProjectSortState = { column: "running", direction: "desc" };
    expect(sortProjects(projects, groups, sort, new Set()).map((p) => p.name)).toEqual([
      "Zulu",
      "Bravo",
      "Alpha",
    ]);
  });

  it("sorts by status using launch-running when no tasks are active", () => {
    const sort: ProjectSortState = { column: "status", direction: "desc" };
    const launchRunningProjectIds = new Set(["p-alpha"]);
    expect(sortProjects(projects, groups, sort, launchRunningProjectIds).map((p) => p.name)).toEqual([
      "Bravo",
      "Zulu",
      "Alpha",
    ]);
  });

  it("sorts pinned projects first when descending", () => {
    const pinnedProjects = [
      makeProject({ id: "p-unpinned", name: "Unpinned" }),
      makeProject({ id: "p-pinned", name: "Pinned", pinned: true }),
    ];
    const sort: ProjectSortState = { column: "pinned", direction: "desc" };
    expect(sortProjects(pinnedProjects, groups, sort, new Set()).map((p) => p.name)).toEqual([
      "Pinned",
      "Unpinned",
    ]);
  });
});

describe("toggleProjectSort", () => {
  it("flips direction on the same column", () => {
    expect(
      toggleProjectSort({ column: "name", direction: "asc" }, "name"),
    ).toEqual({ column: "name", direction: "desc" });
  });

  it("defaults numeric columns to descending", () => {
    expect(
      toggleProjectSort({ column: "name", direction: "asc" }, "updatedAt"),
    ).toEqual({ column: "updatedAt", direction: "desc" });
  });

  it("defaults pinned to descending so pinned projects rise to the top", () => {
    expect(
      toggleProjectSort({ column: "name", direction: "asc" }, "pinned"),
    ).toEqual({ column: "pinned", direction: "desc" });
  });
});
