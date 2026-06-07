import type { Project } from "~/db/schema";
import { LOCAL_SCOPE_ID } from "~/shared/sandbox";
import { worktreeScopeKey } from "~/shared/worktrees";

/** A Project augmented with the caller's currently-selected worktree + runtime scope. */
export type ScopedProject = Project & {
  activeWorktreeId?: string | null;
  activeRuntimeScopeId?: string | null;
};

/** Stable key identifying a project's (worktree × runtime-scope) bucket. */
export function scopeKeyForProject(project: ScopedProject): string {
  return `${worktreeScopeKey(project.id, project.activeWorktreeId)}:${project.activeRuntimeScopeId ?? LOCAL_SCOPE_ID}`;
}
