import { describe, expect, it } from "vitest";
import { groupTasksByStatusForDisplay } from "../task-display-order";
import type { TaskStatus } from "~/shared/domain";

function task(input: {
  id: string;
  status: TaskStatus;
  createdAt: number;
  updatedAt: number;
}) {
  return input;
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
});
