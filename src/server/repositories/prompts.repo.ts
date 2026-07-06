import { and, desc, eq, or, type SQL } from "drizzle-orm";
import { getDb } from "~/db/client";
import { projects, prompts, tasks, type NewPrompt } from "~/db/schema";
import type { PromptSearchResult } from "~/shared/prompts";
import { escapeLike, likeEscaped } from "./_sql";

export function insertPrompt(row: NewPrompt): void {
  getDb().insert(prompts).values(row).run();
}

/**
 * All prompt texts for a task in chronological order (oldest first), capped.
 * Used by the Recall auto-distill pass to summarize what a session was about.
 */
export function listPromptTextsForTask(taskId: string, limit = 40): string[] {
  return getDb()
    .select({ text: prompts.text })
    .from(prompts)
    .where(eq(prompts.taskId, taskId))
    .orderBy(prompts.ts)
    .limit(limit)
    .all()
    .map((r) => r.text);
}

/** Newest prompt for a task — used to dedup near-simultaneous captures. */
export function findRecentPromptForTask(
  taskId: string,
): { text: string; ts: number } | null {
  const row = getDb()
    .select({ text: prompts.text, ts: prompts.ts })
    .from(prompts)
    .where(eq(prompts.taskId, taskId))
    .orderBy(desc(prompts.ts))
    .limit(1)
    .get();
  return row ?? null;
}

const resultColumns = {
  promptId: prompts.id,
  taskId: prompts.taskId,
  projectId: prompts.projectId,
  worktreeId: prompts.worktreeId,
  scopeId: prompts.scopeId,
  agent: prompts.agent,
  text: prompts.text,
  ts: prompts.ts,
  taskTitle: tasks.title,
  taskIcon: tasks.icon,
  projectName: projects.name,
  projectIcon: projects.icon,
  projectIconColor: projects.iconColor,
} as const;

function selectResults(where: SQL | undefined, limit: number): PromptSearchResult[] {
  return getDb()
    .select(resultColumns)
    .from(prompts)
    .innerJoin(tasks, eq(tasks.id, prompts.taskId))
    .innerJoin(projects, eq(projects.id, prompts.projectId))
    .where(where)
    .orderBy(desc(prompts.ts))
    .limit(limit)
    .all();
}

/** Newest prompts across all non-archived sessions (empty-query state). */
export function recentPrompts({ limit }: { limit: number }): PromptSearchResult[] {
  return selectResults(eq(tasks.archived, false), limit);
}

/**
 * Substring search over prompt text — also matches the session title and
 * project name so a phrase in either surfaces the session. Archived sessions
 * are excluded because the open pipeline can't reopen them. SQLite LIKE is
 * case-insensitive for ASCII, which is fine here.
 */
export function searchPrompts({
  query,
  limit,
}: {
  query: string;
  limit: number;
}): PromptSearchResult[] {
  const pattern = `%${escapeLike(query)}%`;
  const match = or(
    likeEscaped(prompts.text, pattern),
    likeEscaped(tasks.title, pattern),
    likeEscaped(projects.name, pattern),
  );
  return selectResults(and(eq(tasks.archived, false), match), limit);
}
