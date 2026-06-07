import { z } from "zod";
import { AGENT_HOOK_EVENTS, mapHookEventToStatus } from "~/shared/agent-hook-events";
import { getTask, updateStatus, updateTask } from "../services/tasks";
import { generateTitleForTask } from "../services/title-generator";
import { handleDomainError, json, jsonError, parseJsonBody } from "./_helpers";
import { HTTP_BAD_REQUEST, HTTP_NOT_FOUND } from "~/shared/http-status";

const hookPayload = z
  .object({
    hook_event_name: z.string(),
    prompt: z.string(),
    notification_type: z.string(),
    message: z.string(),
    title: z.string(),
    session_id: z.string(),
    conversation_id: z.string(),
  })
  .partial();

function hookSessionId(payload: z.infer<typeof hookPayload>): string {
  if (typeof payload.session_id === "string" && payload.session_id.trim()) {
    return payload.session_id.trim();
  }
  if (typeof payload.conversation_id === "string" && payload.conversation_id.trim()) {
    return payload.conversation_id.trim();
  }
  return "";
}

function isSessionCaptureEvent(event: string): boolean {
  return (
    event === AGENT_HOOK_EVENTS.userPromptSubmit ||
    event === AGENT_HOOK_EVENTS.cursorBeforeSubmitPrompt ||
    event === AGENT_HOOK_EVENTS.sessionStart ||
    event === AGENT_HOOK_EVENTS.cursorSessionStart
  );
}

async function reconcileSessionId(
  task: { claudeSessionId: string | null },
  taskId: string,
  incomingSessionId: string,
  event: string,
  updateSessionId: (taskId: string, sessionId: string) => void | Promise<void>,
): Promise<"ok" | "foreign-session"> {
  if (!incomingSessionId) return "ok";

  if (!task.claudeSessionId) {
    if (isSessionCaptureEvent(event)) {
      await updateSessionId(taskId, incomingSessionId);
    }
    return "ok";
  }

  if (incomingSessionId === task.claudeSessionId) return "ok";

  if (isSessionCaptureEvent(event)) {
    await updateSessionId(taskId, incomingSessionId);
    return "ok";
  }

  return "foreign-session";
}

export async function receive(url: URL, request: Request): Promise<Response> {
  const taskId = url.searchParams.get("taskId");
  if (!taskId) return jsonError(HTTP_BAD_REQUEST, "taskId required");

  const parsed = await parseJsonBody(request, hookPayload);
  if (!parsed.ok) return parsed.response;
  const payload = parsed.data;

  const event = payload.hook_event_name || url.searchParams.get("hookEvent") || "";
  const status = mapHookEventToStatus({ ...payload, hook_event_name: event });
  const incomingSessionId = hookSessionId(payload);

  const task = getTask(taskId);
  if (!task) return jsonError(HTTP_NOT_FOUND, "task not found");

  const sessionResult = await reconcileSessionId(
    task,
    taskId,
    incomingSessionId,
    event,
    (id, sessionId) => {
      updateTask(id, { claudeSessionId: sessionId });
    },
  );
  if (sessionResult === "foreign-session") {
    return json({ ok: true, ignored: "foreign-session" });
  }

  if (!status) {
    return json({ ok: true, ignored: event });
  }

  try {
    const t = updateStatus(taskId, { status });
    if (!t) return jsonError(HTTP_NOT_FOUND, "task not found");
    if (
      isSessionCaptureEvent(event) &&
      typeof payload.prompt === "string" &&
      payload.prompt.trim()
    ) {
      void generateTitleForTask(taskId, payload.prompt).catch(() => undefined);
    }
    return json({ ok: true, status });
  } catch (e) {
    const mapped = handleDomainError(e);
    if (mapped) return mapped;
    throw e;
  }
}
