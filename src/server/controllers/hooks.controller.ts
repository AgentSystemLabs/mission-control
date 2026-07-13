import { z } from "zod";
import { AGENT_HOOK_EVENTS, mapHookEventToStatus } from "~/shared/agent-hook-events";
import { ASK_USER_QUESTION_TOOL, parseAskUserQuestionInput } from "~/shared/agent-questions";
import { getTask, updateStatus, updateTask } from "../services/tasks";
import { setPendingQuestion } from "../services/pending-questions";
import { recordPrompt } from "../services/prompts";
import { maybeAutoIndexGraph } from "../services/graph-auto-index";
import { ensureGraphWatch } from "../services/graph-watcher";
import { setTranscriptPath, readLastAssistantText } from "../services/session-transcripts";
import { readRecallSettings } from "../services/recall-settings";
import { getBooleanSetting, readJsonSetting } from "../services/settings";
import { classifyPetToolUse, petToolSentiment } from "~/shared/pet-tool-classify";
import { extractPetRemark, renderPetRemarkInstruction } from "~/shared/pet-remark";
import { events } from "../events";
import {
  assembleTurnContext,
  renderToolLoadInstruction,
  trimToBudget,
} from "../services/proactive-recall";
import { assembleSessionBrief, markMemoriesUsed } from "../services/project-memory";
import { briefDeliveredAt } from "../services/brief-delivery";
import type { TaskAgent } from "~/shared/domain";
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
    // PostToolUse carries the tool's result; the pet sniffs it for errors.
    tool_response: z.unknown(),
    // SessionStart's trigger: "startup" | "resume" | "clear" | "compact".
    source: z.string(),
    // Absolute path to the session's JSONL transcript (Claude Code). Stashed per
    // task so auto-distill can read the full session, not just the prompts.
    transcript_path: z.string(),
    // Stop / SubagentStop carry the turn's final assistant text directly. The
    // transcript file can lag the in-memory conversation (and may not be flushed
    // when Stop fires), so the pet remark prefers this over re-reading the file.
    last_assistant_message: z.string(),
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

// Mirrors settings.controller.ts PET_ENABLED_KEY — the app_settings row that
// backs the Mission Pet master switch. The pet's mid-run tool hook is only
// installed while this is on; we re-check it here so an already-running session
// (whose hook is still on disk) stops emitting the instant the pet is disabled.
const PET_ENABLED_KEY = "pet_enabled";

// The persisted pet identity (settings.controller PET_STATE_KEY) — read only
// for the name, so the remark instruction can address the pet properly.
const PET_STATE_KEY = "pet_state";

function petName(): string | null {
  try {
    const state = readJsonSetting<{ name?: unknown }>(PET_STATE_KEY);
    return state && typeof state.name === "string" && state.name.trim()
      ? state.name.trim()
      : null;
  } catch {
    return null;
  }
}

// Last pet remark emitted per task. The transcript walk can only resurface an
// older response's cue when a turn ends without prose (rare, but Stop also
// re-fires on the same turn); refusing to repeat a task's previous remark
// keeps the pet from parroting stale lines. Bounded like the transcript map.
const MAX_TRACKED_REMARKS = 500;
const lastRemarkByTask = new Map<string, string>();

// The pet's Bash|Write|Edit PostToolUse hook now POSTs on every qualifying tool
// call (no shell-side time gate — see PET_TOOL_HOOK). Meaningful results always
// reach the pet, but a burst of routine neutral edits would churn its mood, so
// the neutral "agent is working" signal is throttled here, per task — after the
// result is classified, which the shell can't do. Bounded like lastRemarkByTask.
const NEUTRAL_TOOL_REACT_COOLDOWN_MS = 8_000;
const MAX_TRACKED_TOOL_REACTS = 500;
const lastNeutralToolReactByTask = new Map<string, number>();

/** True (and records now) when this task's neutral tool signal is off cooldown. */
function allowNeutralToolReact(taskId: string): boolean {
  const now = Date.now();
  const last = lastNeutralToolReactByTask.get(taskId);
  if (last !== undefined && now - last < NEUTRAL_TOOL_REACT_COOLDOWN_MS) return false;
  lastNeutralToolReactByTask.delete(taskId);
  lastNeutralToolReactByTask.set(taskId, now);
  while (lastNeutralToolReactByTask.size > MAX_TRACKED_TOOL_REACTS) {
    const oldest = lastNeutralToolReactByTask.keys().next().value;
    if (oldest === undefined) break;
    lastNeutralToolReactByTask.delete(oldest);
  }
  return true;
}

/** Extract and emit Claude's `<!-- pet: … -->` cue for this turn, if any. */
function emitPetRemark(
  taskId: string,
  projectId: string,
  lastAssistantMessage: string | undefined,
): void {
  try {
    // The hook payload's last_assistant_message is always THIS turn's final
    // text; fall back to the transcript only when the field is absent (older
    // Claude builds, or another agent). The transcript walk can lag or miss a
    // not-yet-flushed message, so the direct field is strictly more reliable.
    const direct =
      typeof lastAssistantMessage === "string" && lastAssistantMessage.trim()
        ? lastAssistantMessage
        : null;
    const text = direct ?? readLastAssistantText(taskId);
    if (!text) return;
    const remark = extractPetRemark(text);
    if (!remark || lastRemarkByTask.get(taskId) === remark) return;
    lastRemarkByTask.delete(taskId);
    lastRemarkByTask.set(taskId, remark);
    while (lastRemarkByTask.size > MAX_TRACKED_REMARKS) {
      const oldest = lastRemarkByTask.keys().next().value;
      if (oldest === undefined) break;
      lastRemarkByTask.delete(oldest);
    }
    events.emit("agent:remark", { taskId, projectId, text: remark });
  } catch {
    // Fail-soft: a torn transcript read must never fault the Stop hook.
  }
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

  // Mid-run tool signal for the Mission Pet: the broad Bash|Write|Edit
  // PostToolUse hook (installed only while the pet is on). The
  // AskUserQuestion-matched PostToolUse is a status signal handled below, so it
  // is excluded here. Pet-gated on both ends — see PET_ENABLED_KEY — so a
  // toggled-off pet stops reacting even for sessions whose hook is still on disk.
  if (
    event === AGENT_HOOK_EVENTS.postToolUse &&
    payload.tool_name !== ASK_USER_QUESTION_TOOL
  ) {
    // A tool just ran, so the agent is provably working — not blocked on the
    // user. If the task is still parked in needs-input (e.g. an AskUserQuestion
    // was answered via "Chat about this" / declined, which fires no
    // AskUserQuestion PostToolUse), heal it back to running now instead of
    // waiting for the turn's Stop hook. updateStatus clears any stale pending
    // question, so the native overlay and the pet's alert both stand down.
    if (task.status === "needs-input") {
      updateStatus(taskId, { status: "running" });
    }
    if (getBooleanSetting(PET_ENABLED_KEY, true)) {
      const toolName = typeof payload.tool_name === "string" ? payload.tool_name : "";
      const kind = classifyPetToolUse(toolName, payload.tool_input, payload.tool_response);
      const sentiment = petToolSentiment(kind);
      // Meaningful results (errors, passing tests, commits, pushes, deploys)
      // always reach the pet; only the routine neutral signal is rate-capped.
      if (sentiment !== "neutral" || allowNeutralToolReact(taskId)) {
        events.emit("agent:tool-used", {
          taskId,
          projectId: task.projectId,
          toolName,
          sentiment,
          kind,
        });
      }
    }
    return json({ ok: true, event });
  }

  // SessionStart carries no status, but it is the fallback channel for the
  // Session Brief: the spawn-time fetch+file-write can lose its race with app
  // startup (see recall.brief.fetch_failed), leaving the session memoryless.
  // This hook fires from INSIDE the live session — if it reached us, we can
  // answer it — so inject a size-capped brief whenever the file channel
  // didn't deliver.
  if (event === AGENT_HOOK_EVENTS.sessionStart) {
    const additionalContext = buildSessionStartBrief(task, taskId, payload.source);
    if (additionalContext) {
      return json({
        ok: true,
        continue: true,
        hookSpecificOutput: {
          hookEventName: AGENT_HOOK_EVENTS.sessionStart,
          additionalContext,
        },
      });
    }
  }

  if (!status) {
    return json({ ok: true, ignored: event });
  }

  // Claude may have ended this turn with an invisible `<!-- pet: … -->` cue
  // (invited by the first-turn instruction below). Surface it BEFORE
  // updateStatus so the remark reaches the renderer ahead of session:finished
  // — the pet then speaks Claude's line instead of a stock finish line.
  if (event === AGENT_HOOK_EVENTS.stop && getBooleanSetting(PET_ENABLED_KEY, true)) {
    emitPetRemark(taskId, task.projectId, payload.last_assistant_message);
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
    // On the session's first turn we also prepend a one-shot instruction that
    // force-loads Recall's deferred MCP tools, so the agent can actually call the
    // mem_*/graph_* tools rather than only reading what we inject.
    // The hook command for UserPromptSubmit passes our stdout through; every
    // other event discards it, so returning these fields elsewhere is harmless.
    if (event === AGENT_HOOK_EVENTS.userPromptSubmit) {
      const toolLoad = buildToolLoadContext(task.agent, taskId, incomingSessionId);
      const petIntro = buildPetRemarkIntro(task.agent, taskId, incomingSessionId);
      const turnContext = buildTurnContext(task.projectId, task.scopeId, payload.prompt);
      const additionalContext = [toolLoad, petIntro, turnContext].filter(Boolean).join("\n\n");
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

// Sessions we've already told to load Recall's deferred MCP tools. Only Claude
// Code defers MCP tools behind a ToolSearch, and once loaded they stay loaded for
// the session, so the nudge fires exactly once per session — re-injecting it every
// turn would just burn tokens. Keyed by task+session so a resumed session (which
// gets a fresh session id, hence unloaded tools) is nudged again. In-memory and
// bounded: losing it on restart costs at most one extra, harmless nudge.
const toolLoadPromptedSessions = new Set<string>();
const TOOL_LOAD_PROMPTED_CAP = 2000;

/**
 * The one-shot, first-turn instruction that force-loads Recall's deferred MCP
 * tools — or "" when it shouldn't fire (non-Claude agent, proactive recall off,
 * or already sent for this session). Fail-soft: never throws, never blocks the turn.
 */
function buildToolLoadContext(agent: TaskAgent, taskId: string, sessionId: string): string {
  // Only Claude Code defers MCP tools behind ToolSearch; other agents load theirs
  // eagerly, so the instruction would be noise (or wrong syntax) for them.
  if (agent !== "claude-code") return "";
  if (!readRecallSettings().proactiveRecallEnabled) return "";
  const key = `${taskId}:${sessionId || "unknown"}`;
  if (toolLoadPromptedSessions.has(key)) return "";
  // Bound growth: a long-lived server would otherwise accumulate a key per
  // session forever. Dropping the whole set on overflow just re-nudges the few
  // currently-active sessions once more — harmless.
  if (toolLoadPromptedSessions.size >= TOOL_LOAD_PROMPTED_CAP) toolLoadPromptedSessions.clear();
  toolLoadPromptedSessions.add(key);
  try {
    return renderToolLoadInstruction();
  } catch {
    return "";
  }
}

// Sessions already told about the pet's remark channel. Same shape and
// rationale as toolLoadPromptedSessions: once per session, keyed task+session
// so a resumed session (fresh context) is re-introduced, bounded in memory.
const petIntroSentSessions = new Set<string>();
const PET_INTRO_SENT_CAP = 2000;

/**
 * The one-shot, first-turn instruction inviting Claude to talk to the pet via
 * `<!-- pet: … -->` cues — or "" when it shouldn't fire (non-Claude agent, pet
 * disabled, or already sent for this session). Fail-soft like its siblings.
 */
function buildPetRemarkIntro(agent: TaskAgent, taskId: string, sessionId: string): string {
  if (agent !== "claude-code") return "";
  if (!getBooleanSetting(PET_ENABLED_KEY, true)) return "";
  const key = `${taskId}:${sessionId || "unknown"}`;
  if (petIntroSentSessions.has(key)) return "";
  if (petIntroSentSessions.size >= PET_INTRO_SENT_CAP) petIntroSentSessions.clear();
  petIntroSentSessions.add(key);
  try {
    return renderPetRemarkInstruction(petName());
  } catch {
    return "";
  }
}

// Claude Code truncates hook output past ~10k characters (it lands in a file
// instead of the context), so the fallback brief must stay well under that
// after JSON-envelope overhead and string escaping.
const SESSION_START_BRIEF_CAP = 8000;

// A spawn-time delivery older than this predates the current PTY: electron
// fetches the brief seconds before spawning, and SessionStart fires right
// after, so on startup/resume a stale timestamp means THIS spawn's fetch
// failed (and the stale file block was stripped).
const SPAWN_DELIVERY_WINDOW_MS = 120_000;

function fileChannelDelivered(taskId: string, source: string | undefined): boolean {
  const deliveredAt = briefDeliveredAt(taskId);
  if (deliveredAt === undefined) return false;
  // clear/compact restart the context mid-session without a new spawn; the
  // spawn-time file is still on disk and reloads, however long ago it was
  // written — any recorded delivery means the file channel has it covered.
  if (source === "clear" || source === "compact") return true;
  return Date.now() - deliveredAt <= SPAWN_DELIVERY_WINDOW_MS;
}

/**
 * The Session Brief to inject at SessionStart when the spawn-time file write
 * didn't deliver it — or "" when it did (or the feature is off, or the agent
 * isn't Claude). Size-capped for the hook-output limit; fail-soft: never
 * throws, never blocks the session from starting.
 */
function buildSessionStartBrief(
  task: { agent: TaskAgent; projectId: string; scopeId: string; title: string | null; branch: string | null },
  taskId: string,
  source: string | undefined,
): string {
  // Only Claude Code's SessionStart hook supports additionalContext injection;
  // other agents' hooks discard the response body anyway.
  if (task.agent !== "claude-code") return "";
  if (!readRecallSettings().injectBriefEnabled) return "";
  if (fileChannelDelivered(taskId, source)) return "";
  try {
    const { markdown, memoryIds } = assembleSessionBrief(task.projectId, task.scopeId, {
      taskTitle: task.title ?? undefined,
      branch: task.branch ?? undefined,
      budget: SESSION_START_BRIEF_CAP,
    });
    const brief = markdown.trim();
    if (!brief) return "";
    if (memoryIds.length) markMemoriesUsed(memoryIds);
    // assembleSessionBrief's budget only bounds the non-core memory section;
    // pinned/overview/stack always go in, so hard-cap the final text too.
    return trimToBudget(brief, SESSION_START_BRIEF_CAP);
  } catch {
    return "";
  }
}
