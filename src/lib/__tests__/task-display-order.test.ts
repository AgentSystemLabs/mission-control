import { describe, expect, it } from "vitest";
import {
  groupActiveListTasksForDisplay,
  groupArchivedTasksForDisplay,
  groupTasksByStatusForDisplay,
} from "../task-display-order";
import type { TaskStatus } from "~/shared/domain";

function task(input: {
  id: string;
  status: TaskStatus;
  createdAt: number;
  updatedAt: number;
  pinned?: boolean;
}) {
  return { pinned: false, ...input };
}

describe("task-display-order", () => {
  it("sorts finished tasks by most recent update first", () => {
    const grouped = groupTasksByStatusForDisplay([
      task({ id: "newer-created", status: "finished", createdAt: 3, updatedAt: 10 }),
      task({ id: "just-finished", status: "finished", createdAt: 1, updatedAt: 30 }),
      task({ id: "middle", status: "finished", createdAt: 2, updatedAt: 20 }),
    ]);

    expect(grouped.finished.map((t) => t.id)).toEqual([
      "just-finished",
      "middle",
      "newer-created",
    ]);
  });

  it("keeps non-finished status buckets in input order", () => {
    const grouped = groupTasksByStatusForDisplay([
      task({ id: "first-running", status: "running", createdAt: 1, updatedAt: 10 }),
      task({ id: "second-running", status: "running", createdAt: 2, updatedAt: 30 }),
    ]);

    expect(grouped.running.map((t) => t.id)).toEqual(["first-running", "second-running"]);
  });

  it("peels pinned sessions into a top section for the Active list", () => {
    const { pinned, byStatus } = groupActiveListTasksForDisplay([
      task({ id: "unpinned-running", status: "running", createdAt: 1, updatedAt: 10 }),
      task({
        id: "pinned-ready",
        status: "ready",
        createdAt: 2,
        updatedAt: 20,
        pinned: true,
      }),
      task({
        id: "pinned-needs",
        status: "needs-input",
        createdAt: 3,
        updatedAt: 30,
        pinned: true,
      }),
      task({ id: "unpinned-ready", status: "ready", createdAt: 4, updatedAt: 40 }),
    ]);

    expect(pinned.map((t) => t.id)).toEqual(["pinned-needs", "pinned-ready"]);
    expect(byStatus.running.map((t) => t.id)).toEqual(["unpinned-running"]);
    expect(byStatus.ready.map((t) => t.id)).toEqual(["unpinned-ready"]);
    expect(byStatus["needs-input"]).toEqual([]);
  });

  it("sorts finished pinned sessions by most recent activity within the pinned section", () => {
    const { pinned } = groupActiveListTasksForDisplay([
      task({
        id: "older-finished",
        status: "finished",
        createdAt: 1,
        updatedAt: 10,
        pinned: true,
      }),
      task({
        id: "newer-finished",
        status: "finished",
        createdAt: 2,
        updatedAt: 40,
        pinned: true,
      }),
      task({
        id: "pinned-running",
        status: "running",
        createdAt: 3,
        updatedAt: 30,
        pinned: true,
      }),
    ]);

    expect(pinned.map((t) => t.id)).toEqual([
      "pinned-running",
      "newer-finished",
      "older-finished",
    ]);
  });

  it("folds every non-finished status into finished for the archived list", () => {
    const grouped = groupArchivedTasksForDisplay([
      task({ id: "done", status: "finished", createdAt: 1, updatedAt: 10 }),
      task({ id: "never-started", status: "ready", createdAt: 2, updatedAt: 40 }),
      task({ id: "older-ready", status: "ready", createdAt: 3, updatedAt: 20 }),
      task({ id: "cut-off", status: "disconnected", createdAt: 4, updatedAt: 30 }),
      task({ id: "cut-short", status: "interrupted", createdAt: 5, updatedAt: 50 }),
      task({ id: "was-running", status: "running", createdAt: 6, updatedAt: 5 }),
      task({ id: "awaiting", status: "needs-input", createdAt: 7, updatedAt: 25 }),
      task({ id: "killed", status: "terminated", createdAt: 8, updatedAt: 15 }),
    ]);

    for (const status of [
      "ready",
      "running",
      "needs-input",
      "interrupted",
      "terminated",
      "disconnected",
    ] as const) {
      expect(grouped[status]).toEqual([]);
    }
    expect(grouped.finished.map((t) => t.id)).toEqual([
      "cut-short",
      "never-started",
      "cut-off",
      "awaiting",
      "older-ready",
      "killed",
      "done",
      "was-running",
    ]);
  });

  it("keeps interrupted as its own column in the active list", () => {
    const { byStatus } = groupActiveListTasksForDisplay([
      task({ id: "cut-short", status: "interrupted", createdAt: 1, updatedAt: 10 }),
      task({ id: "live", status: "running", createdAt: 2, updatedAt: 20 }),
      task({ id: "done", status: "finished", createdAt: 3, updatedAt: 30 }),
    ]);

    expect(byStatus.interrupted.map((t) => t.id)).toEqual(["cut-short"]);
    expect(byStatus.running.map((t) => t.id)).toEqual(["live"]);
    expect(byStatus.finished.map((t) => t.id)).toEqual(["done"]);
  });
});
