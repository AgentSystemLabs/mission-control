import { describe, expect, it } from "vitest";
import { terminalScopeKeysForProject } from "../user-terminal-store";

describe("terminalScopeKeysForProject", () => {
  it("includes every worktree bucket for a project", () => {
    expect(
      terminalScopeKeysForProject(
        {
          "project-1:main": [],
          "project-1:wt-a": [],
          "project-2:main": [],
          "__home__:sb-1": [],
        },
        "project-1",
      ),
    ).toEqual(["project-1:main", "project-1:wt-a"]);
  });

  it("keeps the legacy plain project bucket covered", () => {
    expect(
      terminalScopeKeysForProject(
        {
          "project-1": [],
          "project-1:main": [],
        },
        "project-1",
      ),
    ).toEqual(["project-1", "project-1:main"]);
  });
});
