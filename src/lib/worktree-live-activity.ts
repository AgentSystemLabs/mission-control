import type { Project, Task } from "~/db/schema";
import { isTerminalStatus } from "~/shared/domain";
import { worktreeScopeKey } from "~/shared/worktrees";

type ScopedProject = Project & { activeWorktreeId?: string | null };

export type AgentSessionSnapshot = {
  ptyId: string | null;
  project: ScopedProject;
  task: Pick<Task, "status" | "archived">;
};

export type LiveWorktreeActivity = {
  liveAgentSessionCount: number;
  liveUserTerminalCount: number;
};

export function scopeKeyForScopedProject(project: ScopedProject): string {
  return worktreeScopeKey(project.id, project.activeWorktreeId);
}

export function isBlockingAgentSession(session: AgentSessionSnapshot): boolean {
  if (!session.ptyId) return false;
  if (session.task.archived) return false;
  if (session.task.status === "finished" || isTerminalStatus(session.task.status)) return false;
  return true;
}

export function getLiveWorktreeActivity(
  scopeKey: string,
  agentSessions: ReadonlyArray<AgentSessionSnapshot>,
  userSessions: ReadonlyArray<{ ptyId: string | null }>,
): LiveWorktreeActivity {
  const liveAgentSessionCount = agentSessions.filter(
    (session) =>
      isBlockingAgentSession(session) && scopeKeyForScopedProject(session.project) === scopeKey,
  ).length;
  const liveUserTerminalCount = userSessions.filter((session) => session.ptyId).length;
  return { liveAgentSessionCount, liveUserTerminalCount };
}

export function hasLiveWorktreeActivity(activity: LiveWorktreeActivity): boolean {
  return activity.liveAgentSessionCount > 0 || activity.liveUserTerminalCount > 0;
}

export function describeLiveWorktreeActivity(activity: LiveWorktreeActivity): string {
  const parts: string[] = [];
  if (activity.liveAgentSessionCount > 0) {
    parts.push(
      `${activity.liveAgentSessionCount} active agent session${activity.liveAgentSessionCount === 1 ? "" : "s"}`,
    );
  }
  if (activity.liveUserTerminalCount > 0) {
    parts.push(
      `${activity.liveUserTerminalCount} user terminal${activity.liveUserTerminalCount === 1 ? "" : "s"} active`,
    );
  }
  return parts.join(" and ");
}
