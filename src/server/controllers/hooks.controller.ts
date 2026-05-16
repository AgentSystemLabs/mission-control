import { z } from "zod";
import { mapHookEventToStatus } from "~/shared/agent-hook-events";
import { getTask, updateStatus, updateTask } from "../services/tasks";
import { generateTitleForTask } from "../services/title-generator";
import { requireBearerToken } from "../auth";
import { handleDomainError, json, jsonError, parseJsonBody } from "./_helpers";

const hookPayload = z
  .object({
    hook_event_name: z.string(),
    prompt: z.string(),
    notification_type: z.string(),
    message: z.string(),
    title: z.string(),
    session_id: z.string(),
  })
  .partial();

export async function receive(url: URL, request: Request): Promise<Response> {
  const auth = requireBearerToken(request);
  if (!auth.ok) return auth.response;
  const taskId = url.searchParams.get("taskId");
  if (!taskId) return jsonError(400, "taskId required");

  const parsed = await parseJsonBody(request, hookPayload);
  if (!parsed.ok) return parsed.response;
  const payload = parsed.data;

  const event = payload.hook_event_name || url.searchParams.get("hookEvent") || "";
  const status = mapHookEventToStatus({ ...payload, hook_event_name: event });
  if (!status) return json({ ok: true, ignored: event });

  const task = getTask(taskId);
  if (!task) return jsonError(404, "task not found");

  const incomingSessionId = typeof payload.session_id === "string" ? payload.session_id : "";
  if (
    task.claudeSessionId &&
    incomingSessionId &&
    incomingSessionId !== task.claudeSessionId
  ) {
    if (event === "UserPromptSubmit") {
      updateTask(taskId, { claudeSessionId: incomingSessionId });
    } else {
      return json({ ok: true, ignored: "foreign-session" });
    }
  }

  try {
    const t = updateStatus(taskId, { status });
    if (!t) return jsonError(404, "task not found");
    if (event === "UserPromptSubmit" && typeof payload.prompt === "string" && payload.prompt.trim()) {
      void generateTitleForTask(taskId, payload.prompt);
    }
    return json({ ok: true, status });
  } catch (e) {
    const mapped = handleDomainError(e);
    if (mapped) return mapped;
    throw e;
  }
}
