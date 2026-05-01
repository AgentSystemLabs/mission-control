import type { Project, TaskStatus } from "~/db/schema";

export type ProjectWithCounts = Project & {
  taskCounts: Record<TaskStatus, number> & { total: number; activeNonDone: number };
  preview?: string | null;
  githubUrl?: string | null;
};

export type ProjectActivityState = "offline" | "terminal-running" | "agent-running" | "needs-input";

export function getProjectActivity(
  project: ProjectWithCounts,
  runningProjectIds: ReadonlySet<string>
): ProjectActivityState {
  if (project.taskCounts["needs-input"] > 0) return "needs-input";
  if (project.taskCounts.running > 0) return "agent-running";
  if (runningProjectIds.has(project.id)) return "terminal-running";
  return "offline";
}

export function isProjectActive(activity: ProjectActivityState): boolean {
  return activity !== "offline";
}
