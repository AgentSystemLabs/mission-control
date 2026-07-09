// Consume-once registry of per-task model overrides for sessions started with an
// explicit model (e.g. Ship). createSession stashes the model here; commandForTask
// peeks it so the agent launch command gets `--model`. Cleared on create failure
// so a stranded entry can't leak into a later task with a recycled client id.

import type { AiModelId } from "~/shared/ai-runtime-defaults";

const pending = new Map<string, AiModelId>();
const MAX_PENDING = 16;

export function setPendingSessionModel(taskId: string, model: AiModelId | null | undefined): void {
  if (!model) return;
  if (pending.size >= MAX_PENDING) {
    const oldest = pending.keys().next().value;
    if (oldest !== undefined) pending.delete(oldest);
  }
  pending.set(taskId, model);
}

export function peekPendingSessionModel(taskId: string): AiModelId | null {
  return pending.get(taskId) ?? null;
}

export function clearPendingSessionModel(taskId: string): void {
  pending.delete(taskId);
}
