import type { TaskStatus } from "./domain";
import { ASK_USER_QUESTION_TOOL } from "./agent-questions";

export const AGENT_HOOK_EVENTS = {
  userPromptSubmit: "UserPromptSubmit",
  stop: "Stop",
  userInterrupt: "UserInterrupt",
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
      return payload.tool_name === ASK_USER_QUESTION_TOOL ? "needs-input" : null;
    case AGENT_HOOK_EVENTS.postToolUse:
      return payload.tool_name === ASK_USER_QUESTION_TOOL ? "running" : null;
    default:
      return null;
  }
}

function isPermissionNotification(payload: AgentHookPayload): boolean {
  if (payload.notification_type) {
    return payload.notification_type === AGENT_HOOK_EVENTS.permissionPrompt;
  }
  const text = `${payload.title ?? ""} ${payload.message ?? ""}`.toLowerCase();
  return text.includes("permission");
}
