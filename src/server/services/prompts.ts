import { normalizeScopeId } from "~/shared/sandbox";
import { PROMPT_SEARCH_LIMIT, type PromptSearchResult } from "~/shared/prompts";
import {
  findRecentPromptForTask,
  insertPrompt,
  recentPrompts,
  searchPrompts,
} from "../repositories/prompts.repo";
import { events } from "../events";
import { newId } from "./_ids";
import { getTask } from "./tasks";

// Hook-capable agents (e.g. claude-code) fire BOTH the UserPromptSubmit hook and
// the terminal-capture fallback for a single send, so recordPrompt is called
// twice. Skip the second insert when an identical prompt landed on the same task
// within this window.
const DEDUP_WINDOW_MS = 10_000;
// Guard against pathological pastes bloating the row / search.
const MAX_PROMPT_LEN = 20_000;
const MAX_SEARCH_LIMIT = 200;

/**
 * Persist one submitted prompt. Derives project/worktree/scope/agent from the
 * task, dedups near-simultaneous duplicate captures, and never throws for a
 * missing/empty input (callers treat this as fire-and-forget logging).
 */
export function recordPrompt(input: {
  taskId: string;
  text: string;
  sessionId?: string | null;
}): void {
  const task = getTask(input.taskId);
  if (!task) return;
  const trimmed = input.text.trim();
  if (!trimmed) return;
  const text = trimmed.length > MAX_PROMPT_LEN ? trimmed.slice(0, MAX_PROMPT_LEN) : trimmed;
  const now = Date.now();

  const recent = findRecentPromptForTask(task.id);
  if (recent && recent.text === text && now - recent.ts < DEDUP_WINDOW_MS) return;

  insertPrompt({
    id: newId("prompt"),
    taskId: task.id,
    projectId: task.projectId,
    worktreeId: task.worktreeId,
    scopeId: normalizeScopeId(task.scopeId),
    claudeSessionId: input.sessionId?.trim() || task.claudeSessionId || null,
    agent: task.agent,
    text,
    ts: now,
  });

  // Fed to the renderer over SSE (pet reactions, ambient UI). Emitted after the
  // dedup guard so a hook + terminal double-capture yields a single event.
  events.emit("prompt:submitted", {
    taskId: task.id,
    projectId: task.projectId,
    snippet: text.slice(0, 200),
  });
}

/**
 * Search prompt history. Empty query → the most recent prompts (the palette's
 * initial state); otherwise a substring match over text/title/project.
 */
export function searchPromptHistory(
  query: string,
  limit = PROMPT_SEARCH_LIMIT,
): PromptSearchResult[] {
  const capped = Math.min(Math.max(Math.trunc(limit) || PROMPT_SEARCH_LIMIT, 1), MAX_SEARCH_LIMIT);
  const q = query.trim();
  return q ? searchPrompts({ query: q, limit: capped }) : recentPrompts({ limit: capped });
}
