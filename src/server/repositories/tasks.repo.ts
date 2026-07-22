import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { getDb } from "~/db/client";
import { tasks } from "~/db/schema";
import type { Task } from "~/db/schema";
import { LOCAL_SCOPE_ID, normalizeScopeId } from "~/shared/sandbox";

export function findAllTasks(): Task[] {
  return getDb().select().from(tasks).all();
}

export function findTasksByProjectIdAllScopes(projectId: string): Task[] {
  return getDb().select().from(tasks).where(eq(tasks.projectId, projectId)).all();
}

// Local-scope tasks whose status claims a live agent process. Used by the
// startup sweep: at Electron boot no local PTYs exist yet, so any such task is
// an orphan of a previous run. Sandbox-scoped tasks are excluded — their
// sessions run remotely and survive app restarts.
export function findActiveLocalTasks(): Task[] {
  return getDb()
    .select()
    .from(tasks)
    .where(
      and(
        eq(tasks.scopeId, LOCAL_SCOPE_ID),
        inArray(tasks.status, ["running", "needs-input"]),
      ),
    )
    .all();
}

export function findTasksByProjectId(
  projectId: string,
  scopeId: string | null = LOCAL_SCOPE_ID,
): Task[] {
  return getDb()
    .select()
    .from(tasks)
    .where(and(eq(tasks.projectId, projectId), eq(tasks.scopeId, normalizeScopeId(scopeId))))
    .orderBy(desc(tasks.createdAt))
    .all();
}

export function findTasksByProjectIdAndWorktreeId(
  projectId: string,
  worktreeId: string | null,
  scopeId: string | null = LOCAL_SCOPE_ID,
): Task[] {
  const scope = normalizeScopeId(scopeId);
  return getDb()
    .select()
    .from(tasks)
    .where(
      worktreeId
        ? and(
            eq(tasks.projectId, projectId),
            eq(tasks.worktreeId, worktreeId),
            eq(tasks.scopeId, scope),
          )
        : and(eq(tasks.projectId, projectId), isNull(tasks.worktreeId), eq(tasks.scopeId, scope))
    )
    .orderBy(desc(tasks.createdAt))
    .all();
}

// Hot path (every task read + status poll). Hoist the prepared statement once
// so drizzle/better-sqlite3 skips re-parsing and re-planning the query on each
// call. Lazily built on first use because getDb() must open the connection
// first. `sql.placeholder` binds the id per call.
function buildFindTaskByIdStmt() {
  return getDb()
    .select()
    .from(tasks)
    .where(eq(tasks.id, sql.placeholder("id")))
    .prepare();
}
let findTaskByIdStmt: ReturnType<typeof buildFindTaskByIdStmt> | null = null;

export function findTaskById(id: string): Task | null {
  if (!findTaskByIdStmt) findTaskByIdStmt = buildFindTaskByIdStmt();
  return (findTaskByIdStmt.get({ id }) as Task | undefined) ?? null;
}

export function insertTask(row: Task): void {
  getDb().insert(tasks).values(row).run();
}

export function updateTaskRow(id: string, patch: Partial<Task>): void {
  getDb().update(tasks).set(patch).where(eq(tasks.id, id)).run();
}

export function deleteTaskRow(id: string): number {
  const result = getDb().delete(tasks).where(eq(tasks.id, id)).run();
  return result.changes;
}

export function deleteTasksByScope(scopeId: string): number {
  return getDb().delete(tasks).where(eq(tasks.scopeId, normalizeScopeId(scopeId))).run().changes;
}

export type TaskSessionRef = {
  taskId: string;
  projectId: string;
  claudeSessionId: string;
};

export function findTasksWithClaudeSessionId(): TaskSessionRef[] {
  const rows = getDb()
    .select({
      taskId: tasks.id,
      projectId: tasks.projectId,
      claudeSessionId: tasks.claudeSessionId,
    })
    .from(tasks)
    .where(sql`${tasks.claudeSessionId} IS NOT NULL`)
    .all();
  return rows.map((r) => ({
    taskId: r.taskId,
    projectId: r.projectId,
    claudeSessionId: r.claudeSessionId!,
  }));
}
