import { describe, expect, it } from "vitest";
import type { Project } from "~/db/schema";
import {
  describeLiveWorktreeActivity,
  getLiveWorktreeActivity,
  hasLiveWorktreeActivity,
  isBlockingAgentSession,
} from "../worktree-live-activity";

type ScopedProject = Project & { activeWorktreeId?: string | null };

function makeScopedProject(
  overrides: Partial<ScopedProject> & Pick<ScopedProject, "id">,
): ScopedProject {
  const { id, pinnedOrder, ...rest } = overrides;
  return {
    name: "Test Project",
    path: `/tmp/${id}`,
    icon: "folder",
    iconColor: "#ffffff",
    imagePath: null,
    groupId: null,
    pinned: false,
    pinnedOrder: pinnedOrder ?? null,
    branch: "main",
    launchCommands: null,
    launchUrl: null,
    worktreeSetupCommand: null,
    rememberAgentSettings: false,
    savedAgent: null,
    savedSkipPermissions: false,
    savedBareSession: false,
    createdAt: 1_000,
    updatedAt: 1_000,
    activeWorktreeId: null,
    id,
    ...rest,
  };
}

const mainProject = makeScopedProject({ id: "proj-1" });

describe("worktree-live-activity", () => {
  it("counts only live, non-finished agent sessions in the requested worktree scope", () => {
    const activity = getLiveWorktreeActivity(
      "proj-1:main",
      [
        {
          ptyId: "pty-1",
          project: mainProject,
          task: { status: "running", archived: false },
        },
        {
          ptyId: "pty-2",
          project: makeScopedProject({ id: "proj-1", activeWorktreeId: "wt-a" }),
          task: { status: "running", archived: false },
        },
        {
          ptyId: null,
          project: mainProject,
          task: { status: "running", archived: false },
        },
      ],
      [],
    );

    expect(activity).toEqual({
      liveAgentSessionCount: 1,
      liveUserTerminalCount: 0,
    });
    expect(hasLiveWorktreeActivity(activity)).toBe(true);
  });

  it("ignores finished agent sessions even when a stale PTY id remains", () => {
    expect(
      isBlockingAgentSession({
        ptyId: "pty-stale",
        project: mainProject,
        task: { status: "finished", archived: false },
      }),
    ).toBe(false);

    const activity = getLiveWorktreeActivity(
      "proj-1:main",
      [
        {
          ptyId: "pty-stale",
          project: mainProject,
          task: { status: "finished", archived: false },
        },
      ],
      [],
    );

    expect(activity.liveAgentSessionCount).toBe(0);
    expect(hasLiveWorktreeActivity(activity)).toBe(false);
  });

  it("ignores stale task records and only counts live user terminal PTYs", () => {
    const activity = getLiveWorktreeActivity("proj-1:main", [], [
      { ptyId: null },
      { ptyId: "pty-3" },
    ]);

    expect(activity).toEqual({
      liveAgentSessionCount: 0,
      liveUserTerminalCount: 1,
    });
    expect(describeLiveWorktreeActivity(activity)).toBe("1 user terminal active");
  });

  it("returns false when nothing has a live PTY", () => {
    const activity = getLiveWorktreeActivity(
      "proj-1:main",
      [{ ptyId: null, project: mainProject, task: { status: "running", archived: false } }],
      [{ ptyId: null }],
    );

    expect(hasLiveWorktreeActivity(activity)).toBe(false);
    expect(describeLiveWorktreeActivity(activity)).toBe("");
  });
});
