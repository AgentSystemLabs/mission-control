import type { TaskAgent } from "./domain";

/** Max results returned by the prompt-search endpoint (and default limit). */
export const PROMPT_SEARCH_LIMIT = 50;

/**
 * A single prompt-history row joined with its owning session + project, shaped
 * for the search palette. `worktreeId`/`scopeId` are carried so a result can
 * drive the existing "open a session from elsewhere" pipeline
 * (requestSessionOpenById → openRequestedSession).
 */
export type PromptSearchResult = {
  promptId: string;
  taskId: string;
  projectId: string;
  worktreeId: string | null;
  scopeId: string;
  agent: TaskAgent;
  text: string;
  ts: number;
  taskTitle: string;
  taskIcon: string | null;
  projectName: string;
  projectIcon: string;
  projectIconColor: string;
};

export type PromptSearchResponse = { prompts: PromptSearchResult[] };
