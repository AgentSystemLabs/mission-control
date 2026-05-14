import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, ne, sql } from "drizzle-orm";
import { randomBytes, randomUUID } from "node:crypto";
import * as path from "node:path";
import { ensurePostgresSchema, getPostgresClient, getPostgresDb } from "~/db/postgres";
import * as pg from "~/db/pg-schema";
import type { Group, Project, Task, UserTerminal } from "~/db/schema";
import {
  DEFAULT_BRANCH,
  DEFAULT_TASK_STATUS,
  LAUNCH_COMMANDS_MAX,
  TASK_STATUSES,
  isActiveStatus,
  isTaskAgent,
  isTaskStatus,
  type LaunchCommand,
  type TaskStatus,
} from "~/shared/domain";
import { FREE_PROJECT_CAP } from "~/shared/license";
import { EMPTY_TOTALS, type DailyUsage, type ProjectUsage, type SessionUsage, type TokenTotals } from "~/shared/token-usage";
import { RepositoryProjectCapExceededError, type AppRepositories, type ProjectCreateInput, type ProjectUpdatePatch, type UserScope } from "./types";

type Counts = Record<TaskStatus, number> & { total: number; activeNonDone: number };

function newId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`;
}

function newUuidId(prefix: string) {
  return `${prefix}-${randomUUID()}`;
}

function requireUser(scope?: UserScope): string {
  const userId = scope?.userId?.trim();
  if (!userId) throw new Error("Authenticated user required");
  return userId;
}

function emptyCounts(): Counts {
  const c = TASK_STATUSES.reduce(
    (acc, s) => {
      acc[s] = 0;
      return acc;
    },
    {} as Record<TaskStatus, number>,
  ) as Counts;
  c.total = 0;
  c.activeNonDone = 0;
  return c;
}

function isUniqueConstraintError(err: unknown, seen = new Set<unknown>()): boolean {
  if (!err || typeof err !== "object" || seen.has(err)) return false;
  seen.add(err);
  const e = err as { code?: unknown; message?: unknown; cause?: unknown };
  if (e.code === "23505") return true;
  if (
    typeof e.message === "string" &&
    (/duplicate key value/i.test(e.message) || /violates unique constraint/i.test(e.message))
  ) {
    return true;
  }
  return isUniqueConstraintError(e.cause, seen);
}

function serializeLaunchCommands(input: LaunchCommand[] | null): string | null {
  if (!input) return null;
  if (!Array.isArray(input)) throw new Error("launchCommands must be an array");
  if (input.length > LAUNCH_COMMANDS_MAX) {
    throw new Error(`launchCommands cannot exceed ${LAUNCH_COMMANDS_MAX} entries`);
  }
  const cleaned = input.map((c) => {
    const id = String(c?.id ?? "").trim();
    const name = String(c?.name ?? "").trim();
    const command = String(c?.command ?? "").trim();
    if (!id) throw new Error("launchCommands: id is required");
    if (!name) throw new Error("launchCommands: name is required");
    if (!command) throw new Error("launchCommands: command is required");
    return { id, name, command };
  });
  return cleaned.length === 0 ? null : JSON.stringify(cleaned);
}

function toProject(row: pg.PgProject): Project {
  return {
    ...row,
    ownerUserId: row.ownerUserId ?? null,
    savedAgent: row.savedAgent ?? null,
  };
}

function toGroup(row: pg.PgGroup): Group {
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    createdAt: row.createdAt,
  };
}

function toTask(row: pg.PgTask): Task {
  return row;
}

function toUserTerminal(row: pg.PgUserTerminal): UserTerminal {
  return row;
}

function decorateProject(p: Project, taskCounts: Counts, preview: string | null) {
  return {
    ...p,
    taskCounts,
    preview,
    githubUrl: p.githubUrl ?? null,
  };
}

async function loadCountsByProject(projectIds: string[]): Promise<Map<string, Counts>> {
  const out = new Map<string, Counts>();
  if (projectIds.length === 0) return out;
  const rows = await getPostgresDb()
    .select({
      projectId: pg.tasks.projectId,
      status: pg.tasks.status,
      archived: pg.tasks.archived,
      count: sql<number>`count(*)`,
    })
    .from(pg.tasks)
    .where(inArray(pg.tasks.projectId, projectIds))
    .groupBy(pg.tasks.projectId, pg.tasks.status, pg.tasks.archived);

  for (const r of rows) {
    if (r.archived) continue;
    let c = out.get(r.projectId);
    if (!c) {
      c = emptyCounts();
      out.set(r.projectId, c);
    }
    const status = r.status as TaskStatus;
    const n = Number(r.count) || 0;
    c[status] = (c[status] ?? 0) + n;
    c.total += n;
    if (isActiveStatus(status) && status !== "finished") c.activeNonDone += n;
  }
  return out;
}

async function loadPreviewByProject(projectIds: string[]): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  if (projectIds.length === 0) return out;
  const rows = await getPostgresDb()
    .select({
      projectId: pg.tasks.projectId,
      status: pg.tasks.status,
      preview: pg.tasks.preview,
    })
    .from(pg.tasks)
    .where(
      and(
        eq(pg.tasks.archived, false),
        inArray(pg.tasks.projectId, projectIds),
        sql`${pg.tasks.status} IN ('running','needs-input')`,
      ),
    );
  for (const r of rows) {
    const existing = out.get(r.projectId);
    if (r.status === "running") out.set(r.projectId, r.preview ?? null);
    else if (!existing) out.set(r.projectId, r.preview ?? null);
  }
  return out;
}

async function assertGroupBelongsToOwner(groupId: string | null | undefined, ownerUserId: string): Promise<void> {
  if (!groupId) return;
  const row = (await getPostgresDb()
    .select({ id: pg.groups.id })
    .from(pg.groups)
    .where(and(eq(pg.groups.id, groupId), eq(pg.groups.ownerUserId, ownerUserId)))
    .limit(1))[0];
  if (!row) throw new Error("Group does not belong to the authenticated user");
}

function totalOf(t: TokenTotals): number {
  return t.inputTokens + t.outputTokens + t.cacheCreationTokens + t.cacheReadTokens;
}

function formatLocalDay(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function createPostgresRepositories(): AppRepositories {
  const ready = () => ensurePostgresSchema();
  return {
    mode: "postgres",
    projects: {
      async list(scope) {
        await ready();
        const ownerUserId = requireUser(scope);
        const rows = await getPostgresDb()
          .select()
          .from(pg.projects)
          .where(eq(pg.projects.ownerUserId, ownerUserId))
          .orderBy(asc(pg.projects.createdAt));
        const projectsRows = rows.map(toProject);
        const counts = await loadCountsByProject(projectsRows.map((p) => p.id));
        const previews = await loadPreviewByProject(projectsRows.map((p) => p.id));
        return projectsRows.map((p) => decorateProject(p, counts.get(p.id) ?? emptyCounts(), previews.get(p.id) ?? null));
      },
      async get(id) {
        await ready();
        const row = (await getPostgresDb().select().from(pg.projects).where(eq(pg.projects.id, id)).limit(1))[0];
        if (!row) return null;
        const p = toProject(row);
        const counts = await loadCountsByProject([id]);
        const previews = await loadPreviewByProject([id]);
        return decorateProject(p, counts.get(id) ?? emptyCounts(), previews.get(id) ?? null);
      },
      async getRow(id) {
        await ready();
        const row = (await getPostgresDb().select().from(pg.projects).where(eq(pg.projects.id, id)).limit(1))[0];
        return row ? toProject(row) : null;
      },
      async create(input: ProjectCreateInput) {
        await ready();
        const ownerUserId = input.ownerUserId?.trim();
        if (!ownerUserId) throw new Error("ownerUserId required in cloud mode");
        if (!input.path?.trim()) throw new Error("Repository URL or workspace path is required");
        await assertGroupBelongsToOwner(input.groupId, ownerUserId);
        const db = getPostgresDb();
        const name = input.name?.trim() || path.basename(input.path) || "project";
        const now = Date.now();
        const row = {
          id: newId("p"),
          name,
          path: input.path,
          icon: (input.icon || name.slice(0, 2)).toUpperCase().slice(0, 2),
          iconColor: input.iconColor || "#ff5a1f",
          imagePath: null,
          imageDataUrl: input.imageDataUrl ?? null,
          groupId: input.groupId ?? null,
          pinned: false,
          branch: DEFAULT_BRANCH,
          launchCommands: null,
          launchUrl: null,
          runtimeKind: input.runtimeKind ?? "daytona",
          ownerUserId,
          sandboxId: input.sandboxId ?? null,
          workspacePath: input.workspacePath ?? input.path,
          repoUrl: input.repoUrl ?? null,
          sandboxState: input.sandboxState ?? null,
          rememberAgentSettings: false,
          savedAgent: null,
          savedSkipPermissions: false,
          savedBareSession: false,
          githubUrl: input.repoUrl ?? null,
          createdAt: now,
          updatedAt: now,
        };
        const inserted = await db.transaction(async (tx) => {
          if (!input.pro) {
            const existing = await tx
              .select({ id: pg.projects.id })
              .from(pg.projects)
              .where(eq(pg.projects.ownerUserId, ownerUserId));
            if (existing.length >= FREE_PROJECT_CAP) {
              throw new RepositoryProjectCapExceededError(FREE_PROJECT_CAP, existing.length);
            }
          }
          return (await tx.insert(pg.projects).values(row).returning())[0];
        });
        if (!inserted) throw new Error("Failed to create project");
        return toProject(inserted);
      },
      async update(id, patch: ProjectUpdatePatch, scope?: UserScope) {
        await ready();
        const { launchCommands, ...rest } = patch;
        const ownerUserId = scope?.userId ? requireUser(scope) : null;
        if (patch.groupId !== undefined) {
          const existing = (await getPostgresDb()
            .select({ ownerUserId: pg.projects.ownerUserId })
            .from(pg.projects)
            .where(
              ownerUserId
                ? and(eq(pg.projects.id, id), eq(pg.projects.ownerUserId, ownerUserId))
                : eq(pg.projects.id, id),
            )
            .limit(1))[0];
          if (!existing) return null;
          await assertGroupBelongsToOwner(patch.groupId, existing.ownerUserId);
        }
        const setPatch: Record<string, unknown> = {
          ...rest,
          ...(launchCommands !== undefined ? { launchCommands: serializeLaunchCommands(launchCommands) } : {}),
          updatedAt: Date.now(),
        };
        if (setPatch.ownerUserId === null) delete setPatch.ownerUserId;
        const projectWhere = ownerUserId
          ? and(eq(pg.projects.id, id), eq(pg.projects.ownerUserId, ownerUserId))
          : eq(pg.projects.id, id);
        const updated = (await getPostgresDb()
          .update(pg.projects)
          .set(setPatch)
          .where(projectWhere)
          .returning())[0];
        return updated ? toProject(updated) : null;
      },
      async togglePin(id) {
        await ready();
        const updated = (await getPostgresDb()
          .update(pg.projects)
          .set({ pinned: sql`NOT ${pg.projects.pinned}`, updatedAt: Date.now() })
          .where(eq(pg.projects.id, id))
          .returning())[0];
        return updated ? toProject(updated) : null;
      },
      async delete(id) {
        await ready();
        const db = getPostgresDb();
        const existingRow = (await db.select().from(pg.projects).where(eq(pg.projects.id, id)).limit(1))[0];
        const existing = existingRow ? toProject(existingRow) : null;
        const taskIds = (await db.select({ id: pg.tasks.id }).from(pg.tasks).where(eq(pg.tasks.projectId, id))).map((t) => t.id);
        const userTerminalIds = (await db.select({ id: pg.userTerminals.id }).from(pg.userTerminals).where(eq(pg.userTerminals.projectId, id))).map((t) => t.id);
        const deleted = await db.delete(pg.projects).where(eq(pg.projects.id, id)).returning({ id: pg.projects.id });
        return { deleted: deleted.length > 0, existing, taskIds, userTerminalIds };
      },
      async refreshBranch(id, branch) {
        await ready();
        await getPostgresDb()
          .update(pg.projects)
          .set({ branch, updatedAt: Date.now() })
          .where(and(eq(pg.projects.id, id), ne(pg.projects.branch, branch)));
        return branch;
      },
    },
    groups: {
      async list(scope) {
        await ready();
        const ownerUserId = requireUser(scope);
        const rows = await getPostgresDb()
          .select()
          .from(pg.groups)
          .where(eq(pg.groups.ownerUserId, ownerUserId))
          .orderBy(asc(pg.groups.createdAt));
        return rows.map(toGroup);
      },
      async create(input) {
        await ready();
        const ownerUserId = input.ownerUserId?.trim();
        if (!ownerUserId) throw new Error("ownerUserId required in cloud mode");
        const existing = await this.list({ userId: ownerUserId });
        const row = {
          id: newId("g"),
          ownerUserId,
          name: input.name.trim(),
          color: input.color || ["#ff5a1f", "#8b5cf6", "#22c55e", "#06b6d4"][existing.length % 4] || "#ff5a1f",
          createdAt: Date.now(),
        };
        const inserted = (await getPostgresDb().insert(pg.groups).values(row).returning())[0];
        if (!inserted) throw new Error("Failed to create group");
        return toGroup(inserted);
      },
      async update(id, patch, scope) {
        await ready();
        const ownerUserId = requireUser(scope);
        const updated = (await getPostgresDb()
          .update(pg.groups)
          .set(patch)
          .where(and(eq(pg.groups.id, id), eq(pg.groups.ownerUserId, ownerUserId)))
          .returning())[0];
        return updated ? toGroup(updated) : null;
      },
      async delete(id, scope) {
        await ready();
        const ownerUserId = requireUser(scope);
        await getPostgresDb()
          .update(pg.projects)
          .set({ groupId: null })
          .where(and(eq(pg.projects.groupId, id), eq(pg.projects.ownerUserId, ownerUserId)));
        const deleted = await getPostgresDb()
          .delete(pg.groups)
          .where(and(eq(pg.groups.id, id), eq(pg.groups.ownerUserId, ownerUserId)))
          .returning({ id: pg.groups.id });
        return deleted.length > 0;
      },
    },
    tasks: {
      async listForProject(projectId) {
        await ready();
        return (await getPostgresDb()
          .select()
          .from(pg.tasks)
          .where(eq(pg.tasks.projectId, projectId))
          .orderBy(desc(pg.tasks.createdAt))).map(toTask);
      },
      async get(id) {
        await ready();
        const row = (await getPostgresDb().select().from(pg.tasks).where(eq(pg.tasks.id, id)).limit(1))[0];
        return row ? toTask(row) : null;
      },
      async create(input) {
        await ready();
        if (!input.projectId) throw new Error("projectId required");
        if (!input.title?.trim()) throw new Error("title required");
        if (!isTaskAgent(input.agent)) throw new Error("invalid agent");
        const now = Date.now();
        const row = {
          id: newId("t"),
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
        const inserted = (await getPostgresDb().insert(pg.tasks).values(row).returning())[0];
        if (!inserted) throw new Error("Failed to create task");
        return toTask(inserted);
      },
      async updateStatus(id, patch) {
        await ready();
        if (patch.status && !isTaskStatus(patch.status)) throw new Error("invalid status");
        const db = getPostgresDb();
        return db.transaction(async (tx) => {
          const prev = (await tx.select({ status: pg.tasks.status }).from(pg.tasks).where(eq(pg.tasks.id, id)).limit(1))[0];
          if (!prev) return null;
          const setPatch: Partial<Task> & { updatedAt: number } = { updatedAt: Date.now() };
          if (patch.status !== undefined) setPatch.status = patch.status;
          if (patch.preview !== undefined) setPatch.preview = patch.preview;
          if (patch.lines !== undefined) setPatch.lines = patch.lines;
          const row = (await tx.update(pg.tasks).set(setPatch).where(eq(pg.tasks.id, id)).returning())[0];
          if (!row) return null;
          const project = (await tx.select({ name: pg.projects.name }).from(pg.projects).where(eq(pg.projects.id, row.projectId)).limit(1))[0];
          return { task: toTask(row), previousStatus: prev.status as TaskStatus, projectName: project?.name ?? "Project" };
        });
      },
      async update(id, patch) {
        await ready();
        const row = (await getPostgresDb().update(pg.tasks).set({ ...patch, updatedAt: Date.now() }).where(eq(pg.tasks.id, id)).returning())[0];
        return row ? toTask(row) : null;
      },
      async archive(id) {
        await ready();
        const row = (await getPostgresDb().update(pg.tasks).set({ archived: true, updatedAt: Date.now() }).where(eq(pg.tasks.id, id)).returning())[0];
        return row ? toTask(row) : null;
      },
      async restore(id) {
        await ready();
        const row = (await getPostgresDb().update(pg.tasks).set({ archived: false, updatedAt: Date.now() }).where(eq(pg.tasks.id, id)).returning())[0];
        return row ? toTask(row) : null;
      },
      async delete(id) {
        await ready();
        const db = getPostgresDb();
        const existingRow = (await db.select().from(pg.tasks).where(eq(pg.tasks.id, id)).limit(1))[0];
        const existing = existingRow ? toTask(existingRow) : null;
        if (!existing) return { deleted: false, existing: null };
        const deleted = await db.delete(pg.tasks).where(eq(pg.tasks.id, id)).returning({ id: pg.tasks.id });
        return { deleted: deleted.length > 0, existing };
      },
      async appendTerminalLog(taskId, chunk) {
        await ready();
        const client = getPostgresClient();
        const id = newId("tl");
        await client.begin(async (tx) => {
          await tx`INSERT INTO terminal_logs (id, task_id, chunk, created_at) VALUES (${id}, ${taskId}, ${chunk}, ${Date.now()})`;
          const stats = (await tx<{ total: string; n: string }[]>`SELECT COALESCE(SUM(length(chunk)), 0)::text AS total, COUNT(*)::text AS n FROM terminal_logs WHERE task_id = ${taskId}`)[0];
          let total = Number(stats?.total ?? 0);
          let n = Number(stats?.n ?? 0);
          let guard = 0;
          while (total > 1_000_000 && n > 1 && guard < 8) {
            const avg = Math.max(1, Math.floor(total / n));
            const estimate = Math.min(n - 1, Math.max(1, Math.ceil((total - 1_000_000) / avg)));
            await tx`DELETE FROM terminal_logs WHERE id IN (
              SELECT id FROM terminal_logs WHERE task_id = ${taskId}
              ORDER BY created_at ASC, id ASC LIMIT ${estimate}
            )`;
            const refreshed = (await tx<{ total: string; n: string }[]>`SELECT COALESCE(SUM(length(chunk)), 0)::text AS total, COUNT(*)::text AS n FROM terminal_logs WHERE task_id = ${taskId}`)[0];
            total = Number(refreshed?.total ?? 0);
            n = Number(refreshed?.n ?? 0);
            guard++;
          }
        });
      },
      async readTerminalLog(taskId) {
        await ready();
        const rows = await getPostgresDb()
          .select()
          .from(pg.terminalLogs)
          .where(eq(pg.terminalLogs.taskId, taskId))
          .orderBy(asc(pg.terminalLogs.createdAt));
        return rows.map((r) => r.chunk).join("");
      },
    },
    userTerminals: {
      async list(projectId) {
        await ready();
        return (await getPostgresDb()
          .select()
          .from(pg.userTerminals)
          .where(and(eq(pg.userTerminals.projectId, projectId), isNull(pg.userTerminals.startCommand)))
          .orderBy(asc(pg.userTerminals.position), asc(pg.userTerminals.createdAt))).map(toUserTerminal);
      },
      async purgeLaunchSpawned(projectId) {
        await ready();
        const where = projectId
          ? and(eq(pg.userTerminals.projectId, projectId), isNotNull(pg.userTerminals.startCommand))
          : isNotNull(pg.userTerminals.startCommand);
        const deleted = await getPostgresDb().delete(pg.userTerminals).where(where).returning({ id: pg.userTerminals.id });
        return deleted.length;
      },
      async create(input) {
        await ready();
        const db = getPostgresDb();
        const exists = (await db.select({ id: pg.projects.id }).from(pg.projects).where(eq(pg.projects.id, input.projectId)).limit(1))[0];
        if (!exists) throw new Error("Project does not exist");
        const now = Date.now();
        const startCommand = input.startCommand?.trim() || null;
        const trimmedName = input.name?.trim();
        const id = newUuidId("ut");
        let name = trimmedName;
        if (!name) {
          const rows = await db
            .select({ name: pg.userTerminals.name })
            .from(pg.userTerminals)
            .where(eq(pg.userTerminals.projectId, input.projectId));
          const used = new Set(rows.map((row) => row.name));
          let i = 1;
          do {
            name = `Terminal ${i++}`;
          } while (used.has(name));
        }
        const row = (await db
          .insert(pg.userTerminals)
          .values({
            id,
            projectId: input.projectId,
            name,
            cwd: input.cwd ?? null,
            startCommand,
            position: sql<number>`COALESCE((SELECT MAX(${pg.userTerminals.position}) + 1 FROM ${pg.userTerminals} WHERE ${pg.userTerminals.projectId} = ${input.projectId}), 0)` as unknown as number,
            createdAt: now,
            updatedAt: now,
          })
          .returning())[0];
        if (!row) throw new Error("Failed to create terminal");
        return toUserTerminal(row);
      },
      async rename(id, name) {
        await ready();
        const row = (await getPostgresDb().update(pg.userTerminals).set({ name: name.trim(), updatedAt: Date.now() }).where(eq(pg.userTerminals.id, id)).returning())[0];
        return row ? toUserTerminal(row) : null;
      },
      async delete(id) {
        await ready();
        const db = getPostgresDb();
        const existing = (await db.select({ projectId: pg.userTerminals.projectId }).from(pg.userTerminals).where(eq(pg.userTerminals.id, id)).limit(1))[0];
        const deleted = await db.delete(pg.userTerminals).where(eq(pg.userTerminals.id, id)).returning({ id: pg.userTerminals.id });
        return { deleted: deleted.length > 0, projectId: existing?.projectId ?? null };
      },
      async getProjectId(id) {
        await ready();
        const row = (await getPostgresDb()
          .select({ projectId: pg.userTerminals.projectId })
          .from(pg.userTerminals)
          .where(eq(pg.userTerminals.id, id))
          .limit(1))[0];
        return row?.projectId ?? null;
      },
    },
    settings: {
      async get(key, scope) {
        await ready();
        const ownerUserId = requireUser(scope);
        const row = (await getPostgresDb()
          .select()
          .from(pg.appSettings)
          .where(and(eq(pg.appSettings.ownerUserId, ownerUserId), eq(pg.appSettings.key, key)))
          .limit(1))[0];
        return row?.value ?? null;
      },
      async set(key, value, scope) {
        await ready();
        const ownerUserId = requireUser(scope);
        await getPostgresDb()
          .insert(pg.appSettings)
          .values({ ownerUserId, key, value })
          .onConflictDoUpdate({
            target: [pg.appSettings.ownerUserId, pg.appSettings.key],
            set: { value },
          });
      },
      async delete(key, scope) {
        await ready();
        const ownerUserId = requireUser(scope);
        await getPostgresDb()
          .delete(pg.appSettings)
          .where(and(eq(pg.appSettings.ownerUserId, ownerUserId), eq(pg.appSettings.key, key)));
      },
    },
    usage: {
      async syncTokenUsage() {
        return 0;
      },
      async getUsageSummary(daysBack = 30, scope) {
        await ready();
        const ownerUserId = requireUser(scope);
        const rollupSumCols = {
          inputTokens: sql<number>`COALESCE(SUM(${pg.tokenUsageDailyRollup.inputTokens}), 0)`.as("input_tokens"),
          outputTokens: sql<number>`COALESCE(SUM(${pg.tokenUsageDailyRollup.outputTokens}), 0)`.as("output_tokens"),
          cacheCreationTokens: sql<number>`COALESCE(SUM(${pg.tokenUsageDailyRollup.cacheCreationTokens}), 0)`.as("cache_creation_tokens"),
          cacheReadTokens: sql<number>`COALESCE(SUM(${pg.tokenUsageDailyRollup.cacheReadTokens}), 0)`.as("cache_read_tokens"),
        };
        const sumCols = {
          inputTokens: sql<number>`COALESCE(SUM(${pg.tokenUsage.inputTokens}), 0)`.as("input_tokens"),
          outputTokens: sql<number>`COALESCE(SUM(${pg.tokenUsage.outputTokens}), 0)`.as("output_tokens"),
          cacheCreationTokens: sql<number>`COALESCE(SUM(${pg.tokenUsage.cacheCreationTokens}), 0)`.as("cache_creation_tokens"),
          cacheReadTokens: sql<number>`COALESCE(SUM(${pg.tokenUsage.cacheReadTokens}), 0)`.as("cache_read_tokens"),
        };
        const projectScope = eq(pg.projects.ownerUserId, ownerUserId);
        const totalsRow = (await getPostgresDb()
          .select(rollupSumCols)
          .from(pg.tokenUsageDailyRollup)
          .innerJoin(pg.projects, eq(pg.projects.id, pg.tokenUsageDailyRollup.projectId))
          .where(projectScope))[0];
        const totals: TokenTotals = totalsRow
          ? {
              inputTokens: Number(totalsRow.inputTokens) || 0,
              outputTokens: Number(totalsRow.outputTokens) || 0,
              cacheCreationTokens: Number(totalsRow.cacheCreationTokens) || 0,
              cacheReadTokens: Number(totalsRow.cacheReadTokens) || 0,
            }
          : { ...EMPTY_TOTALS };
        const perProjectRows = await getPostgresDb()
          .select({ projectId: pg.projects.id, name: pg.projects.name, icon: pg.projects.icon, iconColor: pg.projects.iconColor, ...rollupSumCols })
          .from(pg.tokenUsageDailyRollup)
          .innerJoin(pg.projects, eq(pg.projects.id, pg.tokenUsageDailyRollup.projectId))
          .where(projectScope)
          .groupBy(pg.projects.id);
        const perProject: ProjectUsage[] = perProjectRows
          .map((r) => ({ projectId: r.projectId, name: r.name, icon: r.icon, iconColor: r.iconColor, inputTokens: Number(r.inputTokens) || 0, outputTokens: Number(r.outputTokens) || 0, cacheCreationTokens: Number(r.cacheCreationTokens) || 0, cacheReadTokens: Number(r.cacheReadTokens) || 0 }))
          .sort((a, b) => totalOf(b) - totalOf(a));
        const sinceDay = formatLocalDay(new Date(Date.now() - (daysBack - 1) * 86_400_000));
        const perDayRows = await getPostgresDb()
          .select({ day: pg.tokenUsageDailyRollup.day, ...rollupSumCols })
          .from(pg.tokenUsageDailyRollup)
          .innerJoin(pg.projects, eq(pg.projects.id, pg.tokenUsageDailyRollup.projectId))
          .where(and(projectScope, gte(pg.tokenUsageDailyRollup.day, sinceDay)))
          .groupBy(pg.tokenUsageDailyRollup.day);
        const dayMap = new Map<string, DailyUsage>();
        for (const r of perDayRows) dayMap.set(r.day as string, { day: r.day as string, inputTokens: Number(r.inputTokens) || 0, outputTokens: Number(r.outputTokens) || 0, cacheCreationTokens: Number(r.cacheCreationTokens) || 0, cacheReadTokens: Number(r.cacheReadTokens) || 0 });
        const perDay: DailyUsage[] = [];
        for (let i = daysBack - 1; i >= 0; i--) {
          const key = formatLocalDay(new Date(Date.now() - i * 86_400_000));
          perDay.push(dayMap.get(key) ?? { day: key, ...EMPTY_TOTALS });
        }
        const perSessionRows = await getPostgresDb()
          .select({ taskId: pg.tokenUsage.taskId, title: pg.tasks.title, projectId: pg.tasks.projectId, projectName: pg.projects.name, lastTs: sql<number>`MAX(${pg.tokenUsage.ts})`.as("last_ts"), ...sumCols })
          .from(pg.tokenUsage)
          .innerJoin(pg.tasks, eq(pg.tasks.id, pg.tokenUsage.taskId))
          .innerJoin(pg.projects, eq(pg.projects.id, pg.tasks.projectId))
          .where(projectScope)
          .groupBy(pg.tokenUsage.taskId, pg.tasks.title, pg.tasks.projectId, pg.projects.name);
        const perSession: SessionUsage[] = perSessionRows
          .map((r) => ({ taskId: r.taskId, title: r.title, projectId: r.projectId, projectName: r.projectName, lastTs: r.lastTs ? Number(r.lastTs) : null, inputTokens: Number(r.inputTokens) || 0, outputTokens: Number(r.outputTokens) || 0, cacheCreationTokens: Number(r.cacheCreationTokens) || 0, cacheReadTokens: Number(r.cacheReadTokens) || 0 }))
          .sort((a, b) => totalOf(b) - totalOf(a));
        const lastSyncRow = (await getPostgresDb()
          .select({ value: pg.appSettings.value })
          .from(pg.appSettings)
          .where(and(eq(pg.appSettings.ownerUserId, ownerUserId), eq(pg.appSettings.key, "token_usage_last_sync_at")))
          .limit(1))[0];
        const lastSyncedAt = lastSyncRow?.value && Number.isFinite(Number(lastSyncRow.value)) ? Number(lastSyncRow.value) : null;
        return { totals, perProject, perDay, perSession, lastSyncedAt, ingested: 0 };
      },
      resetSyncSingleton() {},
    },
  };
}

export { isUniqueConstraintError };
