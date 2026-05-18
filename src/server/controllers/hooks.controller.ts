import { z } from "zod";
import { mapHookEventToStatus } from "~/shared/agent-hook-events";
import { getTask, updateStatus, updateTask } from "../services/tasks";
import {
  getHostedTaskForHook,
  updateHostedTaskForHook,
  updateHostedTaskStatusForHook,
} from "../services/hosted-projects";
import { validateHostedHookToken } from "../services/hosted-hook-tokens";
import { isHostedDatabaseEnabled } from "../hosted-pg";
import { generateTitleForTask } from "../services/title-generator";
import { logHostedEvent } from "../services/hosted-logs";
import { incrementHostedCounter } from "../services/hosted-metrics";
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
  })
  .partial();

export async function receive(url: URL, request: Request): Promise<Response> {
  const taskId = url.searchParams.get("taskId");
  if (!taskId) return jsonError(HTTP_BAD_REQUEST, "taskId required");

  const parsed = await parseJsonBody(request, hookPayload);
  if (!parsed.ok) return parsed.response;
  const payload = parsed.data;

  const event = payload.hook_event_name || url.searchParams.get("hookEvent") || "";
  const status = mapHookEventToStatus({ ...payload, hook_event_name: event });
  if (!status) {
    logHostedEvent("hook.ignored", { taskId, event: event || "unknown" });
    return json({ ok: true, ignored: event });
  }

  const rawAuth = request.headers.get("authorization") || request.headers.get("Authorization") || "";
  const token = rawAuth.replace(/^Bearer\s+/i, "").trim();
  if (isHostedDatabaseEnabled() && (await validateHostedHookToken(taskId, token))) {
    const task = await getHostedTaskForHook(taskId);
    if (!task) {
      incrementHostedCounter("hookFailures");
      logHostedEvent("hook.task_not_found", { taskId, hosted: true }, "warn");
      return jsonError(HTTP_NOT_FOUND, "task not found");
    }

    const incomingSessionId = typeof payload.session_id === "string" ? payload.session_id : "";
    if (
      task.claudeSessionId &&
      incomingSessionId &&
      incomingSessionId !== task.claudeSessionId
    ) {
      if (event === "UserPromptSubmit") {
        await updateHostedTaskForHook(taskId, { claudeSessionId: incomingSessionId });
      } else {
        logHostedEvent("hook.ignored", { taskId, event, reason: "foreign-session" }, "warn");
        return json({ ok: true, ignored: "foreign-session" });
      }
    }

    const t = await updateHostedTaskStatusForHook(taskId, { status });
    if (!t) {
      incrementHostedCounter("hookFailures");
      logHostedEvent("hook.task_not_found", { taskId, hosted: true }, "warn");
      return jsonError(HTTP_NOT_FOUND, "task not found");
    }
    logHostedEvent("hook.status_updated", { taskId, event, status, hosted: true });
    return json({ ok: true, status });
  }

  const task = getTask(taskId);
  if (!task) return jsonError(HTTP_NOT_FOUND, "task not found");

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
    if (!t) return jsonError(HTTP_NOT_FOUND, "task not found");
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
