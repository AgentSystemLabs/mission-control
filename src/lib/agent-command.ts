import type { Task } from "~/db/schema";
import type { TaskAgent } from "~/shared/domain";
import { buildClaudeCommand, newSessionId } from "./claude-command";

export { newSessionId };

export type AgentLaunchMode = "new" | "resume";

export function isOpencodeSessionId(sessionId: string): boolean {
  return sessionId.startsWith("ses");
}

export function agentUsesPersistedSession(agent: TaskAgent): boolean {
  return (
    agent === "claude-code" ||
    agent === "codex" ||
    agent === "cursor-cli" ||
    agent === "opencode"
  );
}

export function agentLaunchMode(task: Task): AgentLaunchMode {
  if (task.agent === "claude-code") {
    return task.status === "ready" ? "new" : "resume";
  }
  if (task.agent === "cursor-cli") {
    return "resume";
  }
  if (task.agent === "opencode") {
    return task.claudeSessionId &&
      isOpencodeSessionId(task.claudeSessionId) &&
      task.status !== "ready"
      ? "resume"
      : "new";
  }
  if (task.agent === "codex") {
    return task.claudeSessionId && task.status !== "ready" ? "resume" : "new";
  }
  return "new";
}

export function isAgentResumeCommand(agent: TaskAgent, command: string): boolean {
  if (agent === "claude-code" || agent === "cursor-cli") {
    return command.includes("--resume");
  }
  if (agent === "opencode") {
    return command.includes("--session");
  }
  if (agent === "codex") {
    return /\bcodex(?:\s+\S+)*\s+resume(?:\s|$)/.test(command);
  }
  return false;
}

export function buildCursorCommand(opts: {
  sessionId: string;
  skipPermissions: boolean;
}): string {
  const parts = ["cursor-agent", "--resume", opts.sessionId];
  if (opts.skipPermissions) parts.push("--force");
  return parts.join(" ");
}

export function buildOpencodeCommand(opts: {
  mode: AgentLaunchMode;
  sessionId?: string | null;
}): string {
  if (
    opts.mode === "resume" &&
    opts.sessionId &&
    isOpencodeSessionId(opts.sessionId)
  ) {
    return `opencode --session ${opts.sessionId}`;
  }
  return "opencode";
}

export function buildCodexCommand(opts: {
  mode: AgentLaunchMode;
  sessionId?: string | null;
  skipPermissions: boolean;
}): string {
  const parts = ["codex"];
  if (opts.mode === "resume" && opts.sessionId) {
    parts.push("resume", opts.sessionId);
  }
  parts.push("--enable", "hooks");
  if (opts.skipPermissions) parts.push("--yolo");
  return parts.join(" ");
}

export function buildAgentLaunchCommand(
  task: Task,
  sessionId: string,
  mode: AgentLaunchMode,
): string {
  const skipPermissions = !!task.claudeSkipPermissions;
  switch (task.agent) {
    case "claude-code":
      return buildClaudeCommand({
        kind: mode,
        sessionId,
        skipPermissions,
        bareSession: !!task.claudeBareSession,
      });
    case "cursor-cli":
      return buildCursorCommand({ sessionId, skipPermissions });
    case "opencode":
      return buildOpencodeCommand({ mode, sessionId });
    case "codex":
      return buildCodexCommand({
        mode,
        sessionId,
        skipPermissions,
      });
    default:
      throw new Error(`unsupported agent for session launch: ${task.agent}`);
  }
}

export function buildFreshAgentLaunchCommand(task: Task, sessionId: string): string {
  switch (task.agent) {
    case "claude-code":
      return buildAgentLaunchCommand(task, sessionId, "new");
    case "cursor-cli":
      return buildCursorCommand({ sessionId, skipPermissions: !!task.claudeSkipPermissions });
    case "opencode":
      return buildOpencodeCommand({ mode: "new" });
    case "codex":
      return buildCodexCommand({
        mode: "new",
        skipPermissions: !!task.claudeSkipPermissions,
      });
    default:
      throw new Error(`unsupported agent for fresh session launch: ${task.agent}`);
  }
}
