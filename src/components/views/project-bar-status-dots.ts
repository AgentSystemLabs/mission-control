import type { TaskStatus } from "~/shared/domain";

export const PINNED_PROJECT_STATUS_DOT_LIMIT = 4;

export type PinnedProjectStatusDot = Extract<TaskStatus, "running" | "finished">;

const STATUS_DOT_PRECEDENCE = [
  "running",
  "finished",
] as const satisfies readonly PinnedProjectStatusDot[];

export function getPinnedProjectStatusDots(
  counts: Pick<Record<TaskStatus, number>, PinnedProjectStatusDot>
): PinnedProjectStatusDot[] {
  const dots: PinnedProjectStatusDot[] = [];

  for (const status of STATUS_DOT_PRECEDENCE) {
    const openSlots = PINNED_PROJECT_STATUS_DOT_LIMIT - dots.length;
    if (openSlots <= 0) break;

    const count = Math.max(0, Math.trunc(counts[status] ?? 0));
    const dotCount = Math.min(count, openSlots);
    for (let i = 0; i < dotCount; i += 1) dots.push(status);
  }

  return dots;
}
