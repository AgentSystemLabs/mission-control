import { describe, expect, it } from "vitest";
import type { Task } from "~/db/schema";
import {
  OPTIMISTIC_TASK_ID_PREFIX,
  appendOptimisticTask,
  buildOptimisticTask,
  isOptimisticTaskId,
  newOptimisticTaskId,
  removeOptimisticTask,
  removeTaskFromCache,
  removeTasksFromCache,
  replaceOptimisticTask,
  restoreTasksCache,
} from "../optimistic-task";
import { queryKeys } from "~/queries";

function createQueryClientStub() {
  const cache = new Map<string, unknown>();
  return {
    setQueryData: <T,>(key: readonly unknown[], updater: T | ((current: T | undefined) => T)) => {
      const current = cache.get(JSON.stringify(key)) as T | undefined;
      const next = typeof updater === "function" ? (updater as (c: T | undefined) => T)(current) : updater;
      cache.set(JSON.stringify(key), next);
      return next;
    },
    getQueryData: <T,>(key: readonly unknown[]) => cache.get(JSON.stringify(key)) as T | undefined,
  };
}

describe("optimistic-task", () => {
  it("marks optimistic ids with a dedicated prefix", () => {
    const id = newOptimisticTaskId();
    expect(id.startsWith(OPTIMISTIC_TASK_ID_PREFIX)).toBe(true);
    expect(isOptimisticTaskId(id)).toBe(true);
    expect(isOptimisticTaskId("t-abc")).toBe(false);
  });

  it("builds a ready-status placeholder task", () => {
    const task = buildOptimisticTask({
      projectId: "p1",
      worktreeId: null,
      agent: "claude-code",
      branch: "main",
      claudeSessionId: "sess-1",
    });
    expect(task.title).toBe("Waiting for initial prompt...");
    expect(task.status).toBe("ready");
    expect(task.projectId).toBe("p1");
    expect(isOptimisticTaskId(task.id)).toBe(true);
  });

  it("prepends optimistic rows to match server createdAt desc order", () => {
    const qc = createQueryClientStub();
    const key = queryKeys.tasks("p1", null);
    const existing = buildOptimisticTask({
      id: "t-existing",
      projectId: "p1",
      worktreeId: null,
      agent: "codex",
      branch: "main",
    });
    qc.setQueryData(key, [existing]);

    const optimistic = buildOptimisticTask({
      projectId: "p1",
      worktreeId: null,
      agent: "codex",
      branch: "main",
    });
    appendOptimisticTask(qc as never, "p1", null, optimistic);

    const tasks = qc.getQueryData<Task[]>(key)!;
    expect(tasks.map((t) => t.id)).toEqual([optimistic.id, "t-existing"]);
  });

  it("replaces an optimistic row without duplicating the persisted task", () => {
    const qc = createQueryClientStub();
    const key = queryKeys.tasks("p1", null);
    const existing = buildOptimisticTask({
      id: "t-existing",
      projectId: "p1",
      worktreeId: null,
      agent: "codex",
      branch: "main",
    });
    qc.setQueryData(key, [existing]);

    const optimistic = buildOptimisticTask({
      projectId: "p1",
      worktreeId: null,
      agent: "codex",
      branch: "main",
    });
    appendOptimisticTask(qc as never, "p1", null, optimistic);

    const persisted = { ...optimistic, id: "t-real", updatedAt: optimistic.updatedAt + 1 } satisfies Task;
    replaceOptimisticTask(qc as never, "p1", null, optimistic.id, persisted);

    const tasks = qc.getQueryData<Task[]>(key)!;
    expect(tasks).toHaveLength(2);
    expect(tasks[0]?.id).toBe("t-real");
    expect(tasks[1]?.id).toBe("t-existing");
  });

  it("drops an optimistic row on rollback", () => {
    const qc = createQueryClientStub();
    const key = queryKeys.tasks("p1", null);
    const optimistic = buildOptimisticTask({
      projectId: "p1",
      worktreeId: null,
      agent: "codex",
      branch: "main",
    });
    appendOptimisticTask(qc as never, "p1", null, optimistic);
    removeOptimisticTask(qc as never, "p1", null, optimistic.id);
    expect(qc.getQueryData<Task[]>(key)).toEqual([]);
  });

  it("removes persisted tasks from cache and restores on rollback", () => {
    const qc = createQueryClientStub();
    const key = queryKeys.tasks("p1", null);
    const keep = buildOptimisticTask({
      id: "t-keep",
      projectId: "p1",
      worktreeId: null,
      agent: "codex",
      branch: "main",
    });
    const remove = buildOptimisticTask({
      id: "t-remove",
      projectId: "p1",
      worktreeId: null,
      agent: "claude-code",
      branch: "main",
    });
    const snapshot = [keep, remove];
    qc.setQueryData(key, snapshot);

    removeTaskFromCache(qc as never, "p1", null, "t-remove");
    expect(qc.getQueryData<Task[]>(key)).toEqual([keep]);

    restoreTasksCache(qc as never, "p1", null, snapshot);
    expect(qc.getQueryData<Task[]>(key)).toEqual(snapshot);
  });

  it("removes multiple tasks from cache in one update", () => {
    const qc = createQueryClientStub();
    const key = queryKeys.tasks("p1", null);
    const tasks = [
      buildOptimisticTask({ id: "t-1", projectId: "p1", worktreeId: null, agent: "codex", branch: "main" }),
      buildOptimisticTask({ id: "t-2", projectId: "p1", worktreeId: null, agent: "codex", branch: "main" }),
      buildOptimisticTask({ id: "t-3", projectId: "p1", worktreeId: null, agent: "codex", branch: "main" }),
    ];
    qc.setQueryData(key, tasks);

    removeTasksFromCache(qc as never, "p1", null, new Set(["t-1", "t-3"]));
    expect(qc.getQueryData<Task[]>(key)?.map((t) => t.id)).toEqual(["t-2"]);
  });
});
