import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { WORKTREE_NAME_RE } from "~/shared/worktrees";
import { generateWorktreeName, resolveWorktreePath } from "../worktrees";

describe("worktree helpers", () => {
  it("generates three lowercase slug tokens", () => {
    expect(generateWorktreeName()).toMatch(WORKTREE_NAME_RE);
  });

  it("resolves worktrees under the project .worktree directory", () => {
    const root = path.resolve("/tmp/mission-control-project");
    expect(resolveWorktreePath(root, "solar-river-fox")).toBe(
      path.join(root, ".worktree", "solar-river-fox"),
    );
  });

  it("rejects invalid worktree names before path resolution", () => {
    expect(() => resolveWorktreePath("/tmp/project", "../escape-now")).toThrow(
      "invalid worktree name",
    );
  });
});
