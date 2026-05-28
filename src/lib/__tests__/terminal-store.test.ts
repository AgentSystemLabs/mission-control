import { describe, expect, it, vi } from "vitest";
import type { Task } from "~/db/schema";
import {
  commandForTask,
  nextActiveTaskId,
  resolveActiveTaskIdForProject,
} from "../terminal-store";

vi.mock("../api", () => ({
  api: {
    updateTask: vi.fn().mockResolvedValue(undefined),
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
      claudeSessionId: "00000000-0000-4000-8000-000000000000",
      claudeSkipPermissions: true,
    } satisfies Task;

    expect(commandForTask(task)).toBe(
      "cursor-agent --resume 00000000-0000-4000-8000-000000000000 --force",
    );
  });

  it("starts OpenCode without a session id until one is captured", () => {
    const task = {
      ...baseTask,
      agent: "opencode",
      claudeSessionId: null,
    } satisfies Task;

    expect(commandForTask(task)).toBe("opencode");
  });

  it("resumes OpenCode after a ses_* session id is captured", () => {
    const task = {
      ...baseTask,
      agent: "opencode",
      status: "running",
      claudeSessionId: "ses_3cf7dd8d4ffeUPfENpVxfFojZ2",
    } satisfies Task;

    expect(commandForTask(task)).toBe(
      "opencode --session ses_3cf7dd8d4ffeUPfENpVxfFojZ2",
    );
  });

  it("does not pass legacy UUID session ids to OpenCode", () => {
    const task = {
      ...baseTask,
      agent: "opencode",
      claudeSessionId: "00000000-0000-4000-8000-000000000000",
    } satisfies Task;

    expect(commandForTask(task)).toBe("opencode");
  });

  it("starts Codex with hooks until a session id is captured", () => {
    const task = {
      ...baseTask,
      agent: "codex",
      claudeSessionId: null,
      status: "ready",
    } satisfies Task;

    expect(commandForTask(task)).toBe("codex --enable hooks");
  });

  it("resumes Codex after the first prompt captured a session id", () => {
    const task = {
      ...baseTask,
      agent: "codex",
      status: "running",
      claudeSessionId: "019d7a0f-432a-7fa1-a821-b7841f983967",
    } satisfies Task;

    expect(commandForTask(task)).toBe(
      "codex resume 019d7a0f-432a-7fa1-a821-b7841f983967 --enable hooks",
    );
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

describe("resolveActiveTaskIdForProject", () => {
  it("prefers the currently visible worktree scope for root panel lookups", () => {
    expect(
      resolveActiveTaskIdForProject(
        {
          "project-1:main": "main-task",
          "project-1:worktree-a": "worktree-task",
        },
        "project-1",
        { "project-1": "project-1:worktree-a" },
      ),
    ).toEqual({ scopeKey: "project-1:worktree-a", taskId: "worktree-task" });
  });

  it("does not fall back to another worktree when the visible scope has no active task", () => {
    expect(
      resolveActiveTaskIdForProject(
        {
          "project-1:main": "main-task",
          "project-1:worktree-a": "worktree-task",
        },
        "project-1",
        { "project-1": "project-1:worktree-b" },
      ),
    ).toEqual({ scopeKey: "project-1:worktree-b", taskId: null });
  });

  it("uses exact scoped ids without cross-worktree fallback", () => {
    expect(
      resolveActiveTaskIdForProject(
        {
          "project-1:main": "main-task",
          "project-1:worktree-a": "worktree-task",
        },
        "project-1:worktree-b",
      ),
    ).toEqual({ scopeKey: "project-1:worktree-b", taskId: null });
  });

  it("maps legacy plain project active ids to the main worktree scope", () => {
    expect(
      resolveActiveTaskIdForProject({ "project-1": "legacy-task" }, "project-1"),
    ).toEqual({ scopeKey: "project-1:main", taskId: "legacy-task" });
  });
});
