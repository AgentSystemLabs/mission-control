import { describe, expect, it } from "vitest";
import { partitionBranches } from "../branch-picker-model";
import type { GitBranch } from "~/lib/api";
import type { WorktreeInfo } from "~/shared/worktrees";

function worktree(overrides: Partial<WorktreeInfo> & Pick<WorktreeInfo, "id" | "branch">): WorktreeInfo {
  return {
    projectId: "p1",
    name: overrides.id,
    path: `/repo/.worktree/${overrides.id}`,
    isMain: false,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

describe("partitionBranches", () => {
  const branches: GitBranch[] = [
    { name: "main", local: true },
    { name: "feat-a", local: true },
    { name: "feat-b", local: true, remoteRef: "origin/feat-b" },
    { name: "remote-only", local: false, remoteRef: "origin/remote-only" },
  ];

  it("moves branches checked out in worktrees out of the plain list", () => {
    const wt = worktree({ id: "wt_1", branch: "feat-a" });
    const main = worktree({ id: "main", branch: "main", isMain: true });
    const { plainBranches, worktreeByBranch } = partitionBranches(branches, [main, wt]);

    expect(plainBranches.map((b) => b.name)).toEqual(["feat-b", "remote-only"]);
    expect(worktreeByBranch.get("feat-a")).toBe(wt);
    expect(worktreeByBranch.get("main")).toBe(main);
  });

  it("ignores detached worktrees with an empty branch", () => {
    const detached = worktree({ id: "wt_detached", branch: "" });
    const { plainBranches, worktreeByBranch } = partitionBranches(branches, [detached]);

    expect(plainBranches).toHaveLength(branches.length);
    expect(worktreeByBranch.size).toBe(0);
  });

  it("excludes remote-only branches whose name matches a worktree branch", () => {
    const wt = worktree({ id: "wt_2", branch: "remote-only" });
    const { plainBranches } = partitionBranches(branches, [wt]);

    expect(plainBranches.map((b) => b.name)).not.toContain("remote-only");
  });

  it("keeps the first worktree when two report the same branch", () => {
    const first = worktree({ id: "wt_first", branch: "feat-a" });
    const second = worktree({ id: "wt_second", branch: "feat-a" });
    const { worktreeByBranch } = partitionBranches(branches, [first, second]);

    expect(worktreeByBranch.get("feat-a")).toBe(first);
  });
});
