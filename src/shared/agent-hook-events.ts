import type { TaskStatus } from "./domain";
import { isAskUserQuestionTool } from "./agent-questions";

export const AGENT_HOOK_EVENTS = {
  userPromptSubmit: "UserPromptSubmit",
  stop: "Stop",
  stopFailure: "StopFailure",
  subagentStart: "SubagentStart",
  subagentStop: "SubagentStop",
  sessionEnd: "SessionEnd",
  userInterrupt: "UserInterrupt",
  // Synthetic (posted by electron/pty-manager, not the agent): the session's
  // PTY process exited. Named to never collide with Claude Code's real
  // SessionEnd hook, which also fires on /clear while the process lives on.
  sessionProcessExited: "MissionControlSessionEnded",
  permissionRequest: "PermissionRequest",
  questionRequest: "QuestionRequest",
  notification: "Notification",
  preToolUse: "PreToolUse",
  postToolUse: "PostToolUse",
  permissionPrompt: "permission_prompt",
  sessionStart: "SessionStart",
  cursorSessionStart: "sessionStart",
  cursorBeforeSubmitPrompt: "beforeSubmitPrompt",
  cursorStop: "stop",
  cursorAfterAgentResponse: "afterAgentResponse",
} as const;

export type AgentHookPayload = {
  hook_event_name?: string;
  notification_type?: string;
  message?: string;
  title?: string;
  tool_name?: string;
};

export function mapHookEventToStatus(payload: AgentHookPayload): TaskStatus | null {
  switch (payload.hook_event_name || "") {
    case AGENT_HOOK_EVENTS.userPromptSubmit:
    case AGENT_HOOK_EVENTS.cursorBeforeSubmitPrompt:
      return "running";
    case AGENT_HOOK_EVENTS.stop:
    case AGENT_HOOK_EVENTS.cursorStop:
    case AGENT_HOOK_EVENTS.cursorAfterAgentResponse:
      return "finished";
    case AGENT_HOOK_EVENTS.stopFailure:
    case AGENT_HOOK_EVENTS.userInterrupt:
      return "interrupted";
    case AGENT_HOOK_EVENTS.permissionRequest:
    case AGENT_HOOK_EVENTS.questionRequest:
      return "needs-input";
    case AGENT_HOOK_EVENTS.notification:
      return isPermissionNotification(payload) ? "needs-input" : null;
    // Matchers restrict these hooks to AskUserQuestion already; the tool_name
    // guard keeps the mapping precise if a user points their own broader
    // PreToolUse/PostToolUse hooks at Mission Control.
    case AGENT_HOOK_EVENTS.preToolUse:
      return isAskUserQuestionTool(payload.tool_name) ? "needs-input" : null;
    case AGENT_HOOK_EVENTS.postToolUse:
      return isAskUserQuestionTool(payload.tool_name) ? "running" : null;
    // Subagent lifecycle events carry no status of their own — the hooks
    // controller counts them to decide whether a Stop really ends the session
    // (background subagents outlive the foreground turn's Stop).
    case AGENT_HOOK_EVENTS.subagentStart:
    case AGENT_HOOK_EVENTS.subagentStop:
    case AGENT_HOOK_EVENTS.sessionEnd:
      return null;
    // Synthetic PTY-exit event: the hooks controller maps it conditionally
    // (only tasks still in an active status move to terminated/finished).
    case AGENT_HOOK_EVENTS.sessionProcessExited:
      return null;
    default:
      return null;
  }
}

const NATIVE_GROK_EVENT_NAMES: Readonly<Record<string, string>> = {
  session_start: AGENT_HOOK_EVENTS.sessionStart,
  user_prompt_submit: AGENT_HOOK_EVENTS.userPromptSubmit,
  pre_tool_use: AGENT_HOOK_EVENTS.preToolUse,
  post_tool_use: AGENT_HOOK_EVENTS.postToolUse,
  notification: AGENT_HOOK_EVENTS.notification,
  subagent_start: AGENT_HOOK_EVENTS.subagentStart,
  subagent_stop: AGENT_HOOK_EVENTS.subagentStop,
  stop: AGENT_HOOK_EVENTS.stop,
  stop_failure: AGENT_HOOK_EVENTS.stopFailure,
  session_end: AGENT_HOOK_EVENTS.sessionEnd,
};

/** Translate a native Grok hook event to Mission Control's canonical event vocabulary. */
export function normalizeNativeGrokHookEvent(event: string | undefined): string {
  if (!event) return "";
  return NATIVE_GROK_EVENT_NAMES[event] ?? event;
}

function isPermissionNotification(payload: AgentHookPayload): boolean {
  if (payload.notification_type) {
    return payload.notification_type === AGENT_HOOK_EVENTS.permissionPrompt;
  }
  const text = `${payload.title ?? ""} ${payload.message ?? ""}`.toLowerCase();
  return text.includes("permission");
}
