import { describe, expect, it, vi } from "vitest";
import type { Task } from "~/db/schema";
import { commandForTask, nextActiveTaskId } from "../terminal-store";

vi.mock("../api", () => ({
  api: {
    updateTask: vi.fn(),
  },
}));

const baseTask = {
  id: "task-1",
  projectId: "project-1",
  worktreeId: null,
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

  it("passes remembered permission-bypass mode to Cursor CLI", () => {
    const task = {
      ...baseTask,
      agent: "cursor-cli",
      claudeSkipPermissions: true,
    } satisfies Task;

    expect(commandForTask(task)).toBe("cursor-agent --force");
  });
});

describe("nextActiveTaskId", () => {
  it("keeps a stale persisted active task open when no session is materialized", () => {
    expect(nextActiveTaskId("task-1", "task-1", false)).toBe("task-1");
  });

  it("hides a task that is already active and materialized", () => {
    expect(nextActiveTaskId("task-1", "task-1", true)).toBeNull();
  });

  it("switches active tasks", () => {
    expect(nextActiveTaskId("task-1", "task-2", true)).toBe("task-2");
  });
});
