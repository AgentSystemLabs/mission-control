import { z } from "zod";
import { AGENT_HOOK_EVENTS, mapHookEventToStatus } from "~/shared/agent-hook-events";
import { ASK_USER_QUESTION_TOOL, parseAskUserQuestionInput } from "~/shared/agent-questions";
import { getTask, updateStatus, updateTask } from "../services/tasks";
import { setPendingQuestion } from "../services/pending-questions";
import { recordPrompt } from "../services/prompts";
import { generateTitleForTask, isTitleGenerationPrompt } from "../services/title-generator";
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
    tool_name: z.string(),
    tool_use_id: z.string(),
    tool_input: z.unknown(),
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

// Prompt-submit events carry the user's actual prompt text; sessionStart events
// only carry a session id. Only the former should be recorded to history.
function isPromptSubmitEvent(event: string): boolean {
  return (
    event === AGENT_HOOK_EVENTS.userPromptSubmit ||
    event === AGENT_HOOK_EVENTS.cursorBeforeSubmitPrompt
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

  // Store the question before updateStatus so the overlay data is already in
  // place when the task:updated event triggers renderer refetches. Malformed
  // tool_input is fail-soft: status still flips, just no native overlay.
  if (
    event === AGENT_HOOK_EVENTS.preToolUse &&
    payload.tool_name === ASK_USER_QUESTION_TOOL
  ) {
    const questions = parseAskUserQuestionInput(payload.tool_input);
    if (questions) {
      setPendingQuestion({
        taskId,
        projectId: task.projectId,
        questions,
        id: payload.tool_use_id,
      });
    }
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
      payload.prompt.trim() &&
      // Never treat our own headless title-generation helper as a user prompt.
      // If one ever fires these hooks (e.g. it inherited the session hook env),
      // recording it and re-running title generation is the feedback loop that
      // floods prompt history — ignore it outright.
      !isTitleGenerationPrompt(payload.prompt)
    ) {
      void generateTitleForTask(taskId, payload.prompt).catch(() => undefined);
      if (isPromptSubmitEvent(event)) {
        // Fire-and-forget history capture; never let it fail the hook response.
        try {
          recordPrompt({ taskId, text: payload.prompt, sessionId: incomingSessionId || undefined });
        } catch {
          // non-fatal
        }
      }
    }
    return json({ ok: true, status });
  } catch (e) {
    const mapped = handleDomainError(e);
    if (mapped) return mapped;
    throw e;
  }
}
