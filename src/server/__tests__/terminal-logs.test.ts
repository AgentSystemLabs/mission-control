import { beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mc-terminal-logs-test-"));
process.env.MC_USER_DATA_DIR = tmpRoot;

const { getDb } = await import("~/db/client");
const { projects, tasks, terminalLogs } = await import("~/db/schema");
const { createProject } = await import("../services/projects");
const { createTask, appendTerminalLog, readTerminalLog } = await import(
  "../services/tasks"
);

const RING_LIMIT_BYTES = 1_000_000;

describe("appendTerminalLog ring eviction", () => {
  let taskId: string;

  beforeEach(() => {
    const db = getDb();
    db.delete(terminalLogs).run();
    db.delete(tasks).run();
    db.delete(projects).run();
    const dir = fs.mkdtempSync(path.join(tmpRoot, "proj-"));
    const project = createProject({ name: "ring", path: dir });
    const task = createTask({
      projectId: project.id,
      title: "t",
      agent: "claude-code",
    });
    taskId = task.id;
  });

  it("evicts oldest rows once total exceeds the cap", () => {
    const chunk = "x".repeat(100_000);
    for (let i = 0; i < 15; i++) appendTerminalLog(taskId, chunk);

    const buffer = readTerminalLog(taskId);
    expect(buffer.length).toBeLessThanOrEqual(RING_LIMIT_BYTES);
    // Should retain something close to the cap (within one chunk).
    expect(buffer.length).toBeGreaterThan(RING_LIMIT_BYTES - chunk.length);
  });

  it("keeps a single oversized chunk rather than evicting it to empty", () => {
    const giant = "y".repeat(RING_LIMIT_BYTES + 500_000);
    appendTerminalLog(taskId, giant);
    expect(readTerminalLog(taskId).length).toBe(giant.length);
  });
});
