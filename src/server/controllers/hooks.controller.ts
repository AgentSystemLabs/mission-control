import { z } from "zod";
import { AGENT_HOOK_EVENTS, mapHookEventToStatus } from "~/shared/agent-hook-events";
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

function isSessionCaptureEvent(event: string): boolean {
  return (
    event === AGENT_HOOK_EVENTS.userPromptSubmit ||
    event === AGENT_HOOK_EVENTS.cursorBeforeSubmitPrompt ||
    event === AGENT_HOOK_EVENTS.sessionStart
  );
}

function isTitlePromptEvent(event: string): boolean {
  return isSessionCaptureEvent(event);
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

async function captureSessionFromHook(
  task: { claudeSessionId: string | null },
  taskId: string,
  incomingSessionId: string,
  event: string,
  updateSessionId: (taskId: string, sessionId: string) => void | Promise<void>,
): Promise<"ok" | "foreign-session"> {
  if (!incomingSessionId) return "ok";
  return reconcileSessionId(task, taskId, incomingSessionId, event, updateSessionId);
}

export async function receive(url: URL, request: Request): Promise<Response> {
  const taskId = url.searchParams.get("taskId");
  if (!taskId) return jsonError(HTTP_BAD_REQUEST, "taskId required");

  const parsed = await parseJsonBody(request, hookPayload);
  if (!parsed.ok) return parsed.response;
  const payload = parsed.data;

  const event = payload.hook_event_name || url.searchParams.get("hookEvent") || "";
  const status = mapHookEventToStatus({ ...payload, hook_event_name: event });
  const incomingSessionId = typeof payload.session_id === "string" ? payload.session_id : "";

  const rawAuth = request.headers.get("authorization") || request.headers.get("Authorization") || "";
  const token = rawAuth.replace(/^Bearer\s+/i, "").trim();
  if (isHostedDatabaseEnabled() && (await validateHostedHookToken(taskId, token))) {
    const task = await getHostedTaskForHook(taskId);
    if (!task) {
      incrementHostedCounter("hookFailures");
      logHostedEvent("hook.task_not_found", { taskId, hosted: true }, "warn");
      return jsonError(HTTP_NOT_FOUND, "task not found");
    }

    const sessionResult = await captureSessionFromHook(
      task,
      taskId,
      incomingSessionId,
      event,
      async (id, sessionId) => {
        await updateHostedTaskForHook(id, { claudeSessionId: sessionId });
      },
    );
    if (sessionResult === "foreign-session") {
      logHostedEvent("hook.ignored", { taskId, event, reason: "foreign-session" }, "warn");
      return json({ ok: true, ignored: "foreign-session" });
    }

    if (!status) {
      logHostedEvent("hook.ignored", { taskId, event: event || "unknown" });
      return json({ ok: true, ignored: event });
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

  const sessionResult = await captureSessionFromHook(
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
      isTitlePromptEvent(event) &&
      typeof payload.prompt === "string" &&
      payload.prompt.trim()
    ) {
      void generateTitleForTask(taskId, payload.prompt);
    }
    return json({ ok: true, status });
  } catch (e) {
    const mapped = handleDomainError(e);
    if (mapped) return mapped;
    throw e;
  }
}
