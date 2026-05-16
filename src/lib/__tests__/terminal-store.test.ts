import { describe, expect, it, vi } from "vitest";
import type { Task } from "~/db/schema";
import { commandForTask } from "../terminal-store";

vi.mock("../api", () => ({
  api: {
    updateTask: vi.fn(),
  },
}));

const baseTask = {
  id: "task-1",
  projectId: "project-1",
  title: "Task",
  icon: null,
  status: "ready",
  branch: "main",
  preview: "",
  lines: 0,
  archived: false,
  claudeSessionId: null,
  claudeSkipPermissions: false,
  claudeBareSession: false,
  createdAt: 1,
  updatedAt: 1,
} satisfies Omit<Task, "agent">;

describe("commandForTask", () => {
  it("starts a new Claude conversation when a ready task already has a session id", () => {
    const task = {
      ...baseTask,
      agent: "claude-code",
      claudeSessionId: "00000000-0000-4000-8000-000000000000",
    } satisfies Task;

    expect(commandForTask(task)).toBe(
      "claude --session-id 00000000-0000-4000-8000-000000000000",
    );
  });

  it("resumes Claude conversations after the first launch", () => {
    const task = {
      ...baseTask,
      agent: "claude-code",
      status: "running",
      claudeSessionId: "00000000-0000-4000-8000-000000000000",
    } satisfies Task;

    expect(commandForTask(task)).toBe(
      "claude --resume 00000000-0000-4000-8000-000000000000",
    );
  });

  it("passes remembered force mode to Cursor CLI", () => {
    const task = {
      ...baseTask,
      agent: "cursor-cli",
      claudeSkipPermissions: true,
    } satisfies Task;

    expect(commandForTask(task)).toBe("cursor-agent --force");
  });
});
