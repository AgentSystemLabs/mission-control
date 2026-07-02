import type { Task } from "~/db/schema";
import type { TaskAgent } from "~/shared/domain";
import type { AiModelId } from "~/shared/ai-runtime-defaults";
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

export function shouldInjectInitialInput(agent: TaskAgent, isResume: boolean): boolean {
  // Cursor voice launches intentionally start with `--resume <chatId>` so the
  // chat id is stable before hooks run. Seed the first prompt via TTY input even
  // though the command is technically a resume launch.
  return !isResume || agent === "cursor-cli";
}

export function buildCursorCommand(opts: {
  sessionId: string;
  skipPermissions: boolean;
  model?: AiModelId | null;
}): string {
  const parts = ["cursor-agent", "--resume", opts.sessionId];
  if (opts.model) parts.push("--model", opts.model);
  if (opts.skipPermissions) parts.push("--force");
  return parts.join(" ");
}

export function buildOpencodeCommand(opts: {
  mode: AgentLaunchMode;
  sessionId?: string | null;
  model?: AiModelId | null;
}): string {
  const parts = ["opencode"];
  if (opts.model) parts.push("--model", opts.model);
  if (
    opts.mode === "resume" &&
    opts.sessionId &&
    isOpencodeSessionId(opts.sessionId)
  ) {
    parts.push("--session", opts.sessionId);
    return parts.join(" ");
  }
  return parts.join(" ");
}

export function buildCodexCommand(opts: {
  mode: AgentLaunchMode;
  sessionId?: string | null;
  skipPermissions: boolean;
  model?: AiModelId | null;
}): string {
  const parts = ["codex"];
  if (opts.mode === "resume" && opts.sessionId) {
    parts.push("resume", opts.sessionId);
  }
  if (opts.model) parts.push("--model", opts.model);
  parts.push("--enable", "hooks");
  if (opts.skipPermissions) parts.push("--yolo");
  return parts.join(" ");
}

export function buildAgentLaunchCommand(
  task: Task,
  sessionId: string,
  mode: AgentLaunchMode,
  opts: { model?: AiModelId | null } = {},
): string {
  const skipPermissions = !!task.claudeSkipPermissions;
  const model = opts.model ?? null;
  switch (task.agent) {
    case "claude-code":
      return buildClaudeCommand({
        kind: mode,
        sessionId,
        skipPermissions,
        bareSession: !!task.claudeBareSession,
        model,
      });
    case "cursor-cli":
      return buildCursorCommand({ sessionId, skipPermissions, model });
    case "opencode":
      return buildOpencodeCommand({ mode, sessionId, model });
    case "codex":
      return buildCodexCommand({
        mode,
        sessionId,
        skipPermissions,
        model,
      });
    default:
      throw new Error(`unsupported agent for session launch: ${task.agent}`);
  }
}

export function buildFreshAgentLaunchCommand(
  task: Task,
  sessionId: string,
  opts: { model?: AiModelId | null } = {},
): string {
  const model = opts.model ?? null;
  switch (task.agent) {
    case "claude-code":
      return buildAgentLaunchCommand(task, sessionId, "new", { model });
    case "cursor-cli":
      return buildCursorCommand({
        sessionId,
        skipPermissions: !!task.claudeSkipPermissions,
        model,
      });
    case "opencode":
      return buildOpencodeCommand({ mode: "new", model });
    case "codex":
      return buildCodexCommand({
        mode: "new",
        skipPermissions: !!task.claudeSkipPermissions,
        model,
      });
    default:
      throw new Error(`unsupported agent for fresh session launch: ${task.agent}`);
  }
}
