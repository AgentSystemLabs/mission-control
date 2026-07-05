// Automatic capture (per D3): when a session finishes, distill it into a few
// durable, typed memories and write them straight into the active set. Quality
// is enforced at write time — createMemory() dedups/merges by title, everything
// is tagged `inferred`, and distillSession caps the count per pass — so a noisy
// session can't flood Recall. The whole behavior is gated by one setting
// (autoCaptureEnabled) and needs the Recall engine on (it does the distilling).

import type { AppEvent } from "../events";
import { events } from "../events";
import { listPromptTextsForTask } from "../repositories/prompts.repo";
import { getTask } from "./tasks";
import { createMemory } from "./project-memory";
import { distillSession, DISTILL_INPUT_CHAR_BUDGET } from "./recall-engine";
import { readRecallSettings } from "./recall-settings";
import { getTranscriptPath } from "./session-transcripts";
import { readTranscriptForDistill } from "./recall-transcript";

// Stop hooks fire once per agent turn, so session:finished can arrive many times
// in one working session. Distilling on every turn would fan out a CLI each time;
// this cooldown collapses bursts to at most one distill per task per window.
const DISTILL_COOLDOWN_MS = 3 * 60 * 1000;
const lastDistilledAt = new Map<string, number>();

let registered = false;

/** Subscribe the auto-distill pass to session:finished. Idempotent per process. */
export function registerRecallAutoDistill(): void {
  if (registered) return;
  registered = true;
  events.onAny((event) => {
    if (event.type !== "session:finished") return;
    // Fire-and-forget: never let distillation (a CLI round-trip) delay the emit.
    void handleSessionFinished(event).catch(() => undefined);
  });
}

async function handleSessionFinished(
  event: Extract<AppEvent, { type: "session:finished" }>,
): Promise<void> {
  const settings = readRecallSettings();
  // Auto-capture off, or the engine that does the distilling is off → nothing.
  if (!settings.autoCaptureEnabled || !settings.recallEngineEnabled) return;

  const taskId = event.id;
  const now = nowMs();
  const last = lastDistilledAt.get(taskId);
  if (last !== undefined && now - last < DISTILL_COOLDOWN_MS) return;
  lastDistilledAt.set(taskId, now);

  const prompts = listPromptTextsForTask(taskId);
  // Prefer the full session transcript (assistant text + tool activity) when the
  // Stop hook reported its path; fall back to prompts-only when it's absent or
  // unreadable (e.g. non-Claude harnesses never provide it).
  const transcriptPath = getTranscriptPath(taskId);
  const transcript = transcriptPath
    ? readTranscriptForDistill(transcriptPath, { charBudget: DISTILL_INPUT_CHAR_BUDGET })
    : null;
  if (!prompts.length && !transcript) return;

  const task = getTask(taskId);
  const distilled = await distillSession({
    taskTitle: event.taskTitle,
    prompts,
    projectName: event.projectName,
    branch: task?.branch ?? null,
    transcript,
  });
  if (!distilled.length) return;

  let learned = 0;
  for (const mem of distilled) {
    try {
      createMemory({
        projectId: event.projectId,
        scopeId: event.scopeId,
        type: mem.type,
        title: mem.title,
        body: mem.body,
        confidence: "inferred",
        source: "auto-distill",
        sourceTaskId: taskId,
      });
      learned++;
    } catch {
      // A single bad candidate (e.g. validation) must not sink the rest.
    }
  }

  if (learned > 0) {
    events.emit("memory:learned", {
      projectId: event.projectId,
      count: learned,
      sourceTaskId: taskId,
    });
  }
}

// Wrapped so tests can run without the Date.now stubbing the CLI path forbids.
function nowMs(): number {
  return Date.now();
}

/** Test-only: clear the per-task cooldown so successive distills aren't skipped. */
export function __resetAutoDistillCooldown(): void {
  lastDistilledAt.clear();
}
