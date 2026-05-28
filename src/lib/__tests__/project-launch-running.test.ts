import { describe, expect, it } from "vitest";
import {
  getLaunchCommandSet,
  hasRunningLaunchForProject,
  hasRunningLaunchSessions,
  runningLaunchScopeKeysForProject,
} from "../project-launch-running";

describe("project-launch-running", () => {
  it("detects a running launch terminal for the current scope", () => {
    const launchSet = getLaunchCommandSet(
      JSON.stringify([{ id: "dev", name: "Dev", command: "pnpm dev" }])
    );
    expect(
      hasRunningLaunchSessions(
        [
          {
            ptyId: "pty-1",
            terminal: { startCommand: "pnpm dev" },
          },
        ],
        launchSet
      )
    ).toBe(true);
  });

  it("ignores terminals whose start command is not a launch command", () => {
    const launchSet = getLaunchCommandSet(
      JSON.stringify([{ id: "dev", name: "Dev", command: "pnpm dev" }])
    );
    expect(
      hasRunningLaunchSessions(
        [
          {
            ptyId: "pty-1",
            terminal: { startCommand: "npm test" },
          },
        ],
        launchSet
      )
    ).toBe(false);
  });

  it("checks every worktree scope for a project", () => {
    const launchCommands = JSON.stringify([{ id: "dev", name: "Dev", command: "pnpm dev" }]);
    expect(
      hasRunningLaunchForProject("proj-1", launchCommands, {
        "proj-1:main": [{ ptyId: null, terminal: { startCommand: "pnpm dev" } }],
        "proj-1:wt-a": [{ ptyId: "pty-1", terminal: { startCommand: "pnpm dev" } }],
      })
    ).toBe(true);
  });

  it("returns only worktree scopes with launch-created running terminals", () => {
    const launchCommands = JSON.stringify([{ id: "dev", name: "Dev", command: "pnpm dev" }]);
    expect(
      [...runningLaunchScopeKeysForProject("proj-1", launchCommands, {
        "proj-1:main": [{ ptyId: "pty-shell", terminal: { startCommand: null } }],
        "proj-1:wt-a": [{ ptyId: "pty-setup", terminal: { startCommand: "pnpm install" } }],
        "proj-1:wt-b": [{ ptyId: "pty-dev", terminal: { startCommand: "pnpm dev" } }],
      })],
    ).toEqual(["proj-1:wt-b"]);
  });
});
