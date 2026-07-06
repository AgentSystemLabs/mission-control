import { z } from "zod";
import { AGENT_HOOK_EVENTS, mapHookEventToStatus } from "~/shared/agent-hook-events";
import { ASK_USER_QUESTION_TOOL, parseAskUserQuestionInput } from "~/shared/agent-questions";
import { getTask, updateStatus, updateTask } from "../services/tasks";
import { setPendingQuestion } from "../services/pending-questions";
import { recordPrompt } from "../services/prompts";
import { maybeAutoIndexGraph } from "../services/graph-auto-index";
import { ensureGraphWatch } from "../services/graph-watcher";
import { setTranscriptPath } from "../services/session-transcripts";
import { readRecallSettings } from "../services/recall-settings";
import { assembleTurnContext } from "../services/proactive-recall";
import { generateTitleForTask, isTitleGenerationPrompt } from "../services/title-generator";
import { rethrowUnlessDomain, json, jsonError, parseJsonBody } from "./_helpers";
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
    // Absolute path to the session's JSONL transcript (Claude Code). Stashed per
    // task so auto-distill can read the full session, not just the prompts.
    transcript_path: z.string(),
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

  // Stash the transcript path (present on most Claude hooks incl. Stop) so the
  // auto-distill pass can read the full session. Latest wins; stable per session.
  if (typeof payload.transcript_path === "string" && payload.transcript_path.trim()) {
    setTranscriptPath(taskId, payload.transcript_path.trim());
  }

  // Refresh the code graph as sessions come online — fire-and-forget so a build
  // never delays or faults the hook response.
  if (event === AGENT_HOOK_EVENTS.sessionStart) {
    maybeAutoIndexGraph(task.projectId);
  }
  // Keep the live file watcher alive while the project is in active use (session
  // start or any prompt). It re-arms its idle timer and stops itself once quiet.
  if (
    event === AGENT_HOOK_EVENTS.sessionStart ||
    event === AGENT_HOOK_EVENTS.userPromptSubmit
  ) {
    ensureGraphWatch(task.projectId);
  }

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

    // Proactive recall: answer the prompt-submit hook with the memories + code
    // most relevant to this turn, which Claude injects as additional context.
    // The hook command for UserPromptSubmit passes our stdout through; every
    // other event discards it, so returning these fields elsewhere is harmless.
    if (event === AGENT_HOOK_EVENTS.userPromptSubmit) {
      const additionalContext = buildTurnContext(task.projectId, task.scopeId, payload.prompt);
      if (additionalContext) {
        return json({
          ok: true,
          status,
          continue: true,
          hookSpecificOutput: {
            hookEventName: AGENT_HOOK_EVENTS.userPromptSubmit,
            additionalContext,
          },
        });
      }
    }
    return json({ ok: true, status });
  } catch (e) {
    return rethrowUnlessDomain(e);
  }
}

/**
 * Build the proactive per-turn recall block, gated by the setting. Fail-soft:
 * returns "" (inject nothing) on a missing prompt, the feature off, or any error
 * — the turn must never be blocked or faulted by recall assembly.
 */
function buildTurnContext(
  projectId: string,
  scopeId: string,
  promptText: string | undefined,
): string {
  if (typeof promptText !== "string" || !promptText.trim()) return "";
  if (!readRecallSettings().proactiveRecallEnabled) return "";
  try {
    return assembleTurnContext(projectId, scopeId, promptText);
  } catch {
    return "";
  }
}
