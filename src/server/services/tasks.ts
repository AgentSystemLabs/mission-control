import { and, asc, desc, eq } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import type { Statement } from "better-sqlite3";
import { getDb, getSqlite } from "~/db/client";
import { projects, tasks, terminalLogs } from "~/db/schema";
import { DEFAULT_BRANCH, DEFAULT_TASK_STATUS, isTaskAgent, isTaskStatus } from "~/shared/domain";
import type { TaskAgent, TaskStatus } from "~/shared/domain";
import type { Task } from "~/db/schema";
import { events } from "../events";
import { sendTelemetry } from "./telemetry";

function newId() {
  return `t-${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`;
}

export function listTasksForProject(projectId: string): Task[] {
  return getDb()
    .select()
    .from(tasks)
    .where(eq(tasks.projectId, projectId))
    .orderBy(desc(tasks.createdAt))
    .all();
}

export function getTask(id: string): Task | null {
  return getDb().select().from(tasks).where(eq(tasks.id, id)).get() ?? null;
}

export function createTask(input: {
  projectId: string;
  title: string;
  agent: TaskAgent;
  branch?: string;
  status?: TaskStatus;
  preview?: string;
  claudeSessionId?: string | null;
  claudeSkipPermissions?: boolean;
  claudeBareSession?: boolean;
}): Task {
  if (!input.projectId) throw new Error("projectId required");
  if (!input.title?.trim()) throw new Error("title required");
  if (!isTaskAgent(input.agent)) throw new Error("invalid agent");

  const db = getDb();
  const now = Date.now();
  const row: Task = {
    id: newId(),
    projectId: input.projectId,
    title: input.title.trim(),
    agent: input.agent,
    status: input.status ?? DEFAULT_TASK_STATUS,
    branch: input.branch || DEFAULT_BRANCH,
    preview: input.preview ?? "",
    lines: 0,
    archived: false,
    claudeSessionId: input.claudeSessionId ?? null,
    claudeSkipPermissions: input.claudeSkipPermissions ?? false,
    claudeBareSession: input.claudeBareSession ?? false,
    createdAt: now,
    updatedAt: now,
  };
  db.insert(tasks).values(row).run();
  events.emit("task:created", { id: row.id, projectId: row.projectId });
  sendTelemetry("session_started");
  return row;
}

export function updateStatus(
  id: string,
  patch: { status?: TaskStatus; preview?: string; lines?: number }
): Task | null {
  if (patch.status && !isTaskStatus(patch.status)) throw new Error("invalid status");
  const db = getDb();
  const setPatch: Partial<Task> & { updatedAt: number } = { updatedAt: Date.now() };
  if (patch.status !== undefined) setPatch.status = patch.status;
  if (patch.preview !== undefined) setPatch.preview = patch.preview;
  if (patch.lines !== undefined) setPatch.lines = patch.lines;

  // Atomically capture the pre-image status and apply the partial update so a
  // concurrent updateStatus call can't race with us on the finished-transition
  // check.
  const result = getSqlite().transaction(() => {
    const prev = db
      .select({ status: tasks.status })
      .from(tasks)
      .where(eq(tasks.id, id))
      .get();
    if (!prev) return null;
    const row = db
      .update(tasks)
      .set(setPatch)
      .where(eq(tasks.id, id))
      .returning()
      .get();
    return row ? { row, prevStatus: prev.status } : null;
  })();
  if (!result) return null;
  const { row: updated, prevStatus } = result;
  events.emit("task:updated", { id, projectId: updated.projectId });
  if (patch.status === "finished" && prevStatus !== "finished") {
    const project = db
      .select({ name: projects.name })
      .from(projects)
      .where(eq(projects.id, updated.projectId))
      .get();
    events.emit("session:finished", {
      id,
      projectId: updated.projectId,
      projectName: project?.name ?? "Project",
      taskTitle: updated.title,
    });
  }
  return updated;
}

export function updateTask(
  id: string,
  patch: Partial<
    Pick<Task, "title" | "branch" | "claudeSessionId" | "claudeSkipPermissions" | "claudeBareSession">
  >
): Task | null {
  const db = getDb();
  const updated = db
    .update(tasks)
    .set({ ...patch, updatedAt: Date.now() })
    .where(eq(tasks.id, id))
    .returning()
    .get();
  if (!updated) return null;
  events.emit("task:updated", { id, projectId: updated.projectId });
  return updated;
}

export function archiveTask(id: string): Task | null {
  const db = getDb();
  const updated = db
    .update(tasks)
    .set({ archived: true, updatedAt: Date.now() })
    .where(eq(tasks.id, id))
    .returning()
    .get();
  if (!updated) return null;
  events.emit("task:archived", { id, projectId: updated.projectId });
  return updated;
}

export function restoreTask(id: string): Task | null {
  const db = getDb();
  const updated = db
    .update(tasks)
    .set({ archived: false, updatedAt: Date.now() })
    .where(eq(tasks.id, id))
    .returning()
    .get();
  if (!updated) return null;
  events.emit("task:restored", { id, projectId: updated.projectId });
  return updated;
}

export function deleteTask(id: string): boolean {
  const db = getDb();
  const existing = db.select().from(tasks).where(eq(tasks.id, id)).get();
  if (!existing) return false;
  const result = db.delete(tasks).where(eq(tasks.id, id)).run();
  if (result.changes > 0) {
    taskByteCache.delete(id);
    events.emit("task:deleted", { id, projectId: existing.projectId });
    return true;
  }
  return false;
}

const RING_LIMIT_BYTES = 1_000_000;

// Prepare the three statements once per process. Re-preparing per call is the
// dominant cost on the hot path (every terminal chunk hits this). Statements
// are lazily initialized so importing this module doesn't force DB init.
type LogStmts = {
  // Args are variadic in better-sqlite3's typings; we just need run()/get()
  // to accept the positional placeholders.
  insert: Statement<unknown[]>;
  sumBytes: Statement<unknown[]>;
  evict: Statement<unknown[]>;
};
let _logStmts: LogStmts | null = null;
function getLogStmts(): LogStmts {
  if (_logStmts) return _logStmts;
  const sqlite = getSqlite();
  _logStmts = {
    insert: sqlite.prepare(
      "INSERT INTO terminal_logs (id, task_id, chunk, created_at) VALUES (?, ?, ?, ?)"
    ),
    sumBytes: sqlite.prepare(
      "SELECT COALESCE(SUM(length(chunk)), 0) AS total, COUNT(*) AS n FROM terminal_logs WHERE task_id = ?"
    ),
    evict: sqlite.prepare(
      `DELETE FROM terminal_logs WHERE id IN (
         SELECT id FROM terminal_logs WHERE task_id = ?
         ORDER BY created_at ASC, id ASC LIMIT ?
       )`
    ),
  };
  return _logStmts;
}

// Per-task byte cache: avoid re-running SUM(length(chunk)) for every chunk.
// On miss, recompute via SUM; on hit, increment by chunk byte length and only
// re-sum when an eviction makes the cached count unreliable.
const taskByteCache = new Map<string, { total: number; n: number }>();

export function appendTerminalLog(taskId: string, chunk: string) {
  getDb();
  const sqlite = getSqlite();
  const { insert, sumBytes, evict } = getLogStmts();
  const id = `tl-${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`;
  const chunkBytes = Buffer.byteLength(chunk, "utf8");

  const tx = sqlite.transaction((tid: string, c: string) => {
    insert.run(id, tid, c, Date.now());
    let stats = taskByteCache.get(tid);
    if (!stats) {
      stats = sumBytes.get(tid) as { total: number; n: number };
      taskByteCache.set(tid, stats);
    } else {
      // We just inserted; account for it in the cache.
      stats.total += chunkBytes;
      stats.n += 1;
    }
    // Bounded loop: estimate eviction count from average chunk size; re-check
    // after each batch since estimate may undershoot for skewed distributions.
    let guard = 0;
    while (stats.total > RING_LIMIT_BYTES && stats.n > 1 && guard < 8) {
      const oversize = stats.total - RING_LIMIT_BYTES;
      const avg = Math.max(1, Math.floor(stats.total / stats.n));
      const estimate = Math.min(
        stats.n - 1,
        Math.max(1, Math.ceil(oversize / avg))
      );
      evict.run(tid, estimate);
      // Eviction changes total + n in ways the cache can't predict (each
      // evicted row has its own byte size); refresh from SQL.
      stats = sumBytes.get(tid) as { total: number; n: number };
      taskByteCache.set(tid, stats);
      guard++;
    }
  });
  tx(taskId, chunk);
}

export function readTerminalLog(taskId: string): string {
  const all = getDb()
    .select()
    .from(terminalLogs)
    .where(eq(terminalLogs.taskId, taskId))
    .orderBy(asc(terminalLogs.createdAt))
    .all();
  return all.map((r) => r.chunk).join("");
}
