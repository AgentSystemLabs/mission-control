import { useSyncExternalStore } from "react";
import { api } from "~/lib/api";
import type { ServerEvent } from "~/lib/use-events";
import { parseAskUserQuestionInput, type PendingQuestion } from "~/shared/agent-questions";
import { createListenerSet } from "./listener-set";

/**
 * Renderer-side cache of pending AskUserQuestion payloads, keyed by task.
 * Populated from `task:question` SSE events (which carry the full payload, so
 * no query round-trip) and hydrated on demand for panes that mount after the
 * event fired. `undefined` = not hydrated yet, `null` = known to have none.
 */
type Entry = PendingQuestion | null;

const entries = new Map<string, Entry>();
// Questions the user hid locally (esc) — keyed by question id so a NEW
// question on the same task still shows its overlay.
const dismissed = new Set<string>();
const hydrating = new Set<string>();

const { subscribe, notify } = createListenerSet();

export function getTaskQuestion(taskId: string): Entry | undefined {
  return entries.get(taskId);
}

export function getCurrentQuestionId(taskId: string): string | null {
  return entries.get(taskId)?.id ?? null;
}

export function useTaskQuestion(taskId: string): PendingQuestion | null | undefined {
  return useSyncExternalStore(subscribe, () => entries.get(taskId));
}

export function dismissQuestionLocally(questionId: string): void {
  dismissed.add(questionId);
  notify();
}

export function isQuestionDismissed(questionId: string): boolean {
  return dismissed.has(questionId);
}

export function useQuestionDismissed(questionId: string | undefined): boolean {
  return useSyncExternalStore(subscribe, () =>
    questionId ? dismissed.has(questionId) : false,
  );
}

// Questions the user started answering directly in the terminal. Once the TUI
// highlight has moved under our feet, injected key sequences would target the
// wrong row, so the overlay degrades to a passive banner.
const desynced = new Set<string>();

export function markQuestionDesynced(taskId: string): void {
  const questionId = entries.get(taskId)?.id;
  if (!questionId || desynced.has(questionId)) return;
  desynced.add(questionId);
  notify();
}

export function isQuestionDesynced(questionId: string): boolean {
  return desynced.has(questionId);
}

// Feature flag mirrored from Settings → Beta. When off, panes never show the
// overlay and never withhold output — questions are answered in the terminal.
let overlayEnabled = true;

export function setQuestionOverlayEnabled(enabled: boolean): void {
  if (overlayEnabled === enabled) return;
  overlayEnabled = enabled;
  // Notifies pane holds too: turning the popup off mid-question flushes the
  // withheld TUI menu straight into the terminal.
  notify();
}

export function useQuestionOverlayEnabled(): boolean {
  return useSyncExternalStore(subscribe, () => overlayEnabled);
}

/**
 * The question whose TUI menu should be suppressed in the terminal because
 * the popup overlay is answering it. Dismissing the overlay or typing in the
 * terminal (desync) hands the menu back to the terminal — returns null then.
 */
export function getHoldQuestion(taskId: string): PendingQuestion | null {
  if (!overlayEnabled) return null;
  const question = entries.get(taskId);
  if (!question) return null;
  return dismissed.has(question.id) || desynced.has(question.id) ? null : question;
}

/** Subscribe to any store change (non-React consumers, e.g. the menu hold). */
export function subscribeQuestionStore(listener: () => void): () => void {
  return subscribe(listener);
}

export function useQuestionDesynced(questionId: string | undefined): boolean {
  return useSyncExternalStore(subscribe, () =>
    questionId ? desynced.has(questionId) : false,
  );
}

function setEntry(taskId: string, entry: Entry): void {
  const prev = entries.get(taskId);
  if (prev === entry || (prev && entry && prev.id === entry.id)) return;
  if (prev) {
    dismissed.delete(prev.id);
    desynced.delete(prev.id);
  }
  entries.set(taskId, entry);
  notify();
}

function parseQuestionEvent(event: ServerEvent): PendingQuestion | null {
  const taskId = typeof event.taskId === "string" ? event.taskId : "";
  const projectId = typeof event.projectId === "string" ? event.projectId : "";
  const questionId = typeof event.questionId === "string" ? event.questionId : "";
  // The SSE payload is our own emit, but it crosses a JSON boundary — reuse
  // the defensive parser rather than trusting the shape.
  const questions = parseAskUserQuestionInput({ questions: event.questions });
  if (!taskId || !projectId || !questionId || !questions) return null;
  return { id: questionId, taskId, projectId, questions, createdAt: Date.now() };
}

export function applyQuestionServerEvent(event: ServerEvent): void {
  if (event.type === "task:question") {
    const question = parseQuestionEvent(event);
    if (question) setEntry(question.taskId, question);
    return;
  }
  if (event.type === "task:question-cleared") {
    const taskId = typeof event.taskId === "string" ? event.taskId : "";
    if (taskId) setEntry(taskId, null);
    return;
  }
  if (event.type === "task:deleted") {
    const taskId = typeof event.id === "string" ? event.id : "";
    if (taskId && entries.has(taskId)) {
      entries.delete(taskId);
      notify();
    }
  }
}

export async function hydrateTaskQuestion(taskId: string): Promise<void> {
  if (entries.has(taskId) || hydrating.has(taskId)) return;
  hydrating.add(taskId);
  try {
    const { question } = await api.getTaskQuestion(taskId);
    // An SSE event may have landed while the fetch was in flight; it wins.
    if (!entries.has(taskId)) setEntry(taskId, question);
  } catch {
    /* pane falls back to the plain badge */
  } finally {
    hydrating.delete(taskId);
  }
}
