import { describe, expect, it } from "vitest";
import type { Task } from "~/db/schema";
import {
  agentLaunchMode,
  buildAgentLaunchCommand,
  buildCodexCommand,
  buildCursorCommand,
  buildFreshAgentLaunchCommand,
  isAgentResumeCommand,
} from "../agent-command";

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
  claudeSessionId: "00000000-0000-4000-8000-000000000000",
  claudeSkipPermissions: false,
  claudeBareSession: false,
  createdAt: 1,
  updatedAt: 1,
} satisfies Omit<Task, "agent">;

describe("buildCursorCommand", () => {
  it("resumes a persisted Cursor chat", () => {
    expect(
      buildCursorCommand({
        sessionId: "00000000-0000-4000-8000-000000000000",
        skipPermissions: false,
      }),
    ).toBe("cursor-agent --resume 00000000-0000-4000-8000-000000000000");
  });

  it("passes force mode when skip permissions is enabled", () => {
    expect(
      buildCursorCommand({
        sessionId: "00000000-0000-4000-8000-000000000000",
        skipPermissions: true,
      }),
    ).toBe("cursor-agent --resume 00000000-0000-4000-8000-000000000000 --force");
  });
});

describe("buildCodexCommand", () => {
  it("starts a new Codex session with hooks enabled", () => {
    expect(
      buildCodexCommand({
        mode: "new",
        skipPermissions: false,
      }),
    ).toBe("codex --enable hooks");
  });

  it("resumes a persisted Codex session with hooks enabled", () => {
    expect(
      buildCodexCommand({
        mode: "resume",
        sessionId: "019d7a0f-432a-7fa1-a821-b7841f983967",
        skipPermissions: true,
      }),
    ).toBe("codex resume 019d7a0f-432a-7fa1-a821-b7841f983967 --enable hooks --yolo");
  });
});

describe("buildAgentLaunchCommand", () => {
  it("uses Claude session-id for ready tasks", () => {
    const task = { ...baseTask, agent: "claude-code" } satisfies Task;
    expect(buildAgentLaunchCommand(task, task.claudeSessionId!, "new")).toBe(
      "claude --session-id 00000000-0000-4000-8000-000000000000",
    );
  });

  it("uses Cursor resume for every launch", () => {
    const task = { ...baseTask, agent: "cursor-cli" } satisfies Task;
    expect(buildAgentLaunchCommand(task, task.claudeSessionId!, "resume")).toBe(
      "cursor-agent --resume 00000000-0000-4000-8000-000000000000",
    );
  });
});

describe("agentLaunchMode", () => {
  it("resumes Codex only after a session id is known and the task has started", () => {
    expect(
      agentLaunchMode({ ...baseTask, agent: "codex", status: "ready" } satisfies Task),
    ).toBe("new");
    expect(
      agentLaunchMode({
        ...baseTask,
        agent: "codex",
        status: "running",
        claudeSessionId: null,
      } satisfies Task),
    ).toBe("new");
    expect(
      agentLaunchMode({
        ...baseTask,
        agent: "codex",
        status: "running",
      } satisfies Task),
    ).toBe("resume");
  });
});

describe("isAgentResumeCommand", () => {
  it("detects resume launches for each supported agent", () => {
    expect(
      isAgentResumeCommand(
        "claude-code",
        "claude --resume 00000000-0000-4000-8000-000000000000",
      ),
    ).toBe(true);
    expect(isAgentResumeCommand("cursor-cli", "cursor-agent --resume abc")).toBe(true);
    expect(
      isAgentResumeCommand(
        "codex",
        "codex resume 019d7a0f-432a-7fa1-a821-b7841f983967 --enable hooks",
      ),
    ).toBe(true);
    expect(isAgentResumeCommand("codex", "codex --enable hooks")).toBe(false);
  });
});

describe("buildFreshAgentLaunchCommand", () => {
  it("falls back to a fresh Codex session without resume", () => {
    const task = {
      ...baseTask,
      agent: "codex",
      status: "running",
    } satisfies Task;
    expect(buildFreshAgentLaunchCommand(task, "fresh-id")).toBe("codex --enable hooks");
  });
});
