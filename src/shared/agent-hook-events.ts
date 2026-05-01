import type { TaskStatus } from "./domain";

export const AGENT_HOOK_EVENTS = {
  userPromptSubmit: "UserPromptSubmit",
  stop: "Stop",
  userInterrupt: "UserInterrupt",
  permissionRequest: "PermissionRequest",
  notification: "Notification",
  permissionPrompt: "permission_prompt",
} as const;

export type AgentHookPayload = {
  hook_event_name?: string;
  notification_type?: string;
  message?: string;
  title?: string;
};

export function mapHookEventToStatus(payload: AgentHookPayload): TaskStatus | null {
  switch (payload.hook_event_name || "") {
    case AGENT_HOOK_EVENTS.userPromptSubmit:
      return "running";
    case AGENT_HOOK_EVENTS.stop:
    case AGENT_HOOK_EVENTS.userInterrupt:
      return "finished";
    case AGENT_HOOK_EVENTS.permissionRequest:
      return "needs-input";
    case AGENT_HOOK_EVENTS.notification:
      return isPermissionNotification(payload) ? "needs-input" : null;
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
