import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, ne, sql } from "drizzle-orm";
import { randomBytes, randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import type { Statement } from "better-sqlite3";
import { getDb, getSqlite } from "~/db/client";
import {
  appSettings,
  groups,
  projects,
  tasks,
  terminalLogs,
  tokenUsage,
  tokenUsageDailyRollup,
  tokenUsageSessionOffsets,
  userTerminals,
  type Group,
  type Project,
  type Task,
  type UserTerminal,
} from "~/db/schema";
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
import { RepositoryProjectCapExceededError, type AppRepositories, type ProjectCreateInput, type ProjectUpdatePatch } from "./types";

type Counts = Record<TaskStatus, number> & { total: number; activeNonDone: number };

function newId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`;
}

function newUuidId(prefix: string) {
  return `${prefix}-${randomUUID()}`;
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

async function detectGithubUrl(dir: string): Promise<string | null> {
  try {
    const cfg = path.join(dir, ".git", "config");
    let text: string;
    try {
      text = await fs.promises.readFile(cfg, "utf8");
    } catch {
      return null;
    }
    const m = text.match(/\[remote "origin"\][^[]*?url\s*=\s*(\S+)/);
    if (!m) return null;
    const url = m[1].trim();
    const ssh = url.match(/^git@github\.com:([^/]+\/[^/\s]+?)(?:\.git)?$/);
    if (ssh) return `https://github.com/${ssh[1]}`;
    const https = url.match(/^(?:https?|ssh):\/\/(?:[^@]+@)?github\.com\/([^/]+\/[^/\s]+?)(?:\.git)?$/);
    if (https) return `https://github.com/${https[1]}`;
    return null;
  } catch {
    return null;
  }
}

function detectGithubUrlSync(dir: string): string | null {
  try {
    const cfg = path.join(dir, ".git", "config");
    const text = fs.readFileSync(cfg, "utf8");
    const m = text.match(/\[remote "origin"\][^[]*?url\s*=\s*(\S+)/);
    if (!m) return null;
    const url = m[1].trim();
    const ssh = url.match(/^git@github\.com:([^/]+\/[^/\s]+?)(?:\.git)?$/);
    if (ssh) return `https://github.com/${ssh[1]}`;
    const https = url.match(/^(?:https?|ssh):\/\/(?:[^@]+@)?github\.com\/([^/]+\/[^/\s]+?)(?:\.git)?$/);
    if (https) return `https://github.com/${https[1]}`;
    return null;
  } catch {
    return null;
  }
}

async function detectBranch(dir: string): Promise<string> {
  try {
    const content = (await fs.promises.readFile(path.join(dir, ".git", "HEAD"), "utf8")).trim();
    if (content.startsWith("ref: refs/heads/")) return content.replace("ref: refs/heads/", "");
    return content.slice(0, 7);
  } catch {
    return DEFAULT_BRANCH;
  }
}

function isUniqueConstraintError(err: unknown, seen = new Set<unknown>()): boolean {
  if (!err || typeof err !== "object" || seen.has(err)) return false;
  seen.add(err);
  const e = err as { code?: unknown; message?: unknown; cause?: unknown };
  if (e.code === "SQLITE_CONSTRAINT_UNIQUE" || e.code === "SQLITE_CONSTRAINT_PRIMARYKEY") {
    return true;
  }
  if (typeof e.message === "string" && /UNIQUE constraint failed/i.test(e.message)) {
    return true;
  }
  return isUniqueConstraintError(e.cause, seen);
}

function decorateProject(p: Project, taskCounts: Counts, preview: string | null) {
  return {
    ...p,
    taskCounts,
    preview,
    githubUrl: p.githubUrl ?? null,
  };
}

function loadCountsByProject(projectIds?: string[]): Map<string, Counts> {
  const db = getDb();
  const rows = db
    .select({
      projectId: tasks.projectId,
      status: tasks.status,
      archived: tasks.archived,
      count: sql<number>`count(*)`,
    })
    .from(tasks)
    .where(projectIds && projectIds.length > 0 ? inArray(tasks.projectId, projectIds) : undefined)
    .groupBy(tasks.projectId, tasks.status, tasks.archived)
    .all();

  const out = new Map<string, Counts>();
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

function loadPreviewByProject(projectIds: string[]): Map<string, string | null> {
  const out = new Map<string, string | null>();
  if (projectIds.length === 0) return out;
  const rows = getDb()
    .select({
      projectId: tasks.projectId,
      status: tasks.status,
      preview: tasks.preview,
    })
    .from(tasks)
    .where(
      sql`${tasks.archived} = 0 AND ${tasks.status} IN ('running','needs-input') AND ${inArray(tasks.projectId, projectIds)}`,
    )
    .all();
  for (const r of rows) {
    const existing = out.get(r.projectId);
    if (r.status === "running") out.set(r.projectId, r.preview ?? null);
    else if (!existing) out.set(r.projectId, r.preview ?? null);
  }
  return out;
}

const RING_LIMIT_BYTES = 1_000_000;
type LogStmts = {
  insert: Statement<unknown[]>;
  sumBytes: Statement<unknown[]>;
  evict: Statement<unknown[]>;
};
let _logStmts: LogStmts | null = null;
function getLogStmts(): LogStmts {
  if (_logStmts) return _logStmts;
  const sqlite = getSqlite();
  _logStmts = {
    insert: sqlite.prepare("INSERT INTO terminal_logs (id, task_id, chunk, created_at) VALUES (?, ?, ?, ?)"),
    sumBytes: sqlite.prepare("SELECT COALESCE(SUM(length(chunk)), 0) AS total, COUNT(*) AS n FROM terminal_logs WHERE task_id = ?"),
    evict: sqlite.prepare(
      `DELETE FROM terminal_logs WHERE id IN (
         SELECT id FROM terminal_logs WHERE task_id = ?
         ORDER BY created_at ASC, id ASC LIMIT ?
       )`,
    ),
  };
  return _logStmts;
}
const taskByteCache = new Map<string, { total: number; n: number }>();

function formatLocalDay(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function totalOf(t: TokenTotals): number {
  return t.inputTokens + t.outputTokens + t.cacheCreationTokens + t.cacheReadTokens;
}

function getLastSyncedAt(): number | null {
  const row = getSqlite()
    .prepare("SELECT value FROM app_settings WHERE key = 'token_usage_last_sync_at'")
    .get() as { value?: string } | undefined;
  if (!row?.value) return null;
  const n = Number(row.value);
  return Number.isFinite(n) ? n : null;
}

export function createSqliteRepositories(): AppRepositories {
  return {
    mode: "sqlite",
    projects: {
      async list() {
        const rows = getDb().select().from(projects).orderBy(asc(projects.createdAt)).all();
        const counts = loadCountsByProject(rows.map((r) => r.id));
        const previews = loadPreviewByProject(rows.map((r) => r.id));
        return rows.map((p) => decorateProject(p, counts.get(p.id) ?? emptyCounts(), previews.get(p.id) ?? null));
      },
      async get(id) {
        const p = getDb().select().from(projects).where(eq(projects.id, id)).get();
        if (!p) return null;
        const counts = loadCountsByProject([id]);
        const previews = loadPreviewByProject([id]);
        return decorateProject(p, counts.get(id) ?? emptyCounts(), previews.get(id) ?? null);
      },
      async getRow(id) {
        return getDb().select().from(projects).where(eq(projects.id, id)).get() ?? null;
      },
      async create(input: ProjectCreateInput) {
        if (!input.path?.trim()) throw new Error("Working directory is required");
        const runtimeKind = input.runtimeKind ?? "local";
        if (runtimeKind === "local") {
          if (!fs.existsSync(input.path)) throw new Error("Working directory does not exist");
          const stat = fs.statSync(input.path);
          if (!stat.isDirectory()) throw new Error("Working directory must be a directory");
        }
        const name = input.name?.trim() || path.basename(input.path) || "project";
        const now = Date.now();
        const id = newId("p");
        const githubUrl = input.repoUrl ?? (runtimeKind === "local" ? await detectGithubUrl(input.path) : null);
        const row: Project = {
          id,
          name,
          path: input.path,
          icon: (input.icon || name.slice(0, 2)).toUpperCase().slice(0, 2),
          iconColor: input.iconColor || "#ff5a1f",
          imagePath: null,
          imageDataUrl: input.imageDataUrl ?? null,
          groupId: input.groupId ?? null,
          pinned: false,
          branch: runtimeKind === "local" ? await detectBranch(input.path) : DEFAULT_BRANCH,
          launchCommands: null,
          launchUrl: null,
          runtimeKind,
          ownerUserId: input.ownerUserId ?? null,
          sandboxId: input.sandboxId ?? null,
          workspacePath: input.workspacePath ?? input.path,
          repoUrl: githubUrl,
          sandboxState: input.sandboxState ?? null,
          rememberAgentSettings: false,
          savedAgent: null,
          savedSkipPermissions: false,
          savedBareSession: false,
          githubUrl,
          createdAt: now,
          updatedAt: now,
        };
        getDb().transaction((tx) => {
          if (!input.pro) {
            const existing = tx.select({ id: projects.id }).from(projects).all();
            if (existing.length >= FREE_PROJECT_CAP) {
              throw new RepositoryProjectCapExceededError(FREE_PROJECT_CAP, existing.length);
            }
          }
          tx.insert(projects).values(row).run();
        });
        return row;
      },
      async update(id, patch: ProjectUpdatePatch) {
        const { launchCommands, ...rest } = patch;
        const setPatch: Partial<Project> & { updatedAt: number } = {
          ...rest,
          ...(launchCommands !== undefined ? { launchCommands: serializeLaunchCommands(launchCommands) } : {}),
          ...(typeof patch.path === "string" && patch.path.trim() ? { githubUrl: detectGithubUrlSync(patch.path) } : {}),
          updatedAt: Date.now(),
        };
        return (
          getDb()
            .update(projects)
            .set(setPatch)
            .where(eq(projects.id, id))
            .returning()
            .get() ?? null
        );
      },
      async togglePin(id) {
        return (
          getDb()
            .update(projects)
            .set({ pinned: sql`NOT ${projects.pinned}`, updatedAt: Date.now() })
            .where(eq(projects.id, id))
            .returning()
            .get() ?? null
        );
      },
      async delete(id) {
        const db = getDb();
        const existing = db.select().from(projects).where(eq(projects.id, id)).get() ?? null;
        const taskIds = db.select({ id: tasks.id }).from(tasks).where(eq(tasks.projectId, id)).all().map((t) => t.id);
        const userTerminalIds = db.select({ id: userTerminals.id }).from(userTerminals).where(eq(userTerminals.projectId, id)).all().map((t) => t.id);
        const result = db.delete(projects).where(eq(projects.id, id)).run();
        return { deleted: result.changes > 0, existing, taskIds, userTerminalIds };
      },
      async refreshBranch(id, branch) {
        const updated = getDb()
          .update(projects)
          .set({ branch, updatedAt: Date.now() })
          .where(and(eq(projects.id, id), ne(projects.branch, branch)))
          .returning({ id: projects.id })
          .get();
        return updated ? branch : branch;
      },
    },
    groups: {
      async list() {
        return getDb().select().from(groups).orderBy(asc(groups.createdAt)).all();
      },
      async create(input) {
        const existing = await this.list();
        const row: Group = {
          id: newId("g"),
          name: input.name.trim(),
          color: input.color || ["#ff5a1f", "#8b5cf6", "#22c55e", "#06b6d4"][existing.length % 4] || "#ff5a1f",
          createdAt: Date.now(),
        };
        getDb().insert(groups).values(row).run();
        return row;
      },
      async update(id, patch) {
        const existing = getDb().select().from(groups).where(eq(groups.id, id)).get();
        if (!existing) return null;
        const next = { ...existing, ...patch };
        getDb().update(groups).set(next).where(eq(groups.id, id)).run();
        return next;
      },
      async delete(id) {
        const db = getDb();
        db.update(projects).set({ groupId: null }).where(eq(projects.groupId, id)).run();
        return db.delete(groups).where(eq(groups.id, id)).run().changes > 0;
      },
    },
    tasks: {
      async listForProject(projectId) {
        return getDb().select().from(tasks).where(eq(tasks.projectId, projectId)).orderBy(desc(tasks.createdAt)).all();
      },
      async get(id) {
        return getDb().select().from(tasks).where(eq(tasks.id, id)).get() ?? null;
      },
      async create(input) {
        if (!input.projectId) throw new Error("projectId required");
        if (!input.title?.trim()) throw new Error("title required");
        if (!isTaskAgent(input.agent)) throw new Error("invalid agent");
        const now = Date.now();
        const row: Task = {
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
        getDb().insert(tasks).values(row).run();
        return row;
      },
      async updateStatus(id, patch) {
        if (patch.status && !isTaskStatus(patch.status)) throw new Error("invalid status");
        const db = getDb();
        const setPatch: Partial<Task> & { updatedAt: number } = { updatedAt: Date.now() };
        if (patch.status !== undefined) setPatch.status = patch.status;
        if (patch.preview !== undefined) setPatch.preview = patch.preview;
        if (patch.lines !== undefined) setPatch.lines = patch.lines;
        const result = getSqlite().transaction(() => {
          const prev = db.select({ status: tasks.status }).from(tasks).where(eq(tasks.id, id)).get();
          if (!prev) return null;
          const row = db.update(tasks).set(setPatch).where(eq(tasks.id, id)).returning().get();
          if (!row) return null;
          const project = db.select({ name: projects.name }).from(projects).where(eq(projects.id, row.projectId)).get();
          return { task: row, previousStatus: prev.status as TaskStatus, projectName: project?.name ?? "Project" };
        })();
        return result;
      },
      async update(id, patch) {
        return getDb().update(tasks).set({ ...patch, updatedAt: Date.now() }).where(eq(tasks.id, id)).returning().get() ?? null;
      },
      async archive(id) {
        return getDb().update(tasks).set({ archived: true, updatedAt: Date.now() }).where(eq(tasks.id, id)).returning().get() ?? null;
      },
      async restore(id) {
        return getDb().update(tasks).set({ archived: false, updatedAt: Date.now() }).where(eq(tasks.id, id)).returning().get() ?? null;
      },
      async delete(id) {
        const db = getDb();
        const existing = db.select().from(tasks).where(eq(tasks.id, id)).get() ?? null;
        if (!existing) return { deleted: false, existing: null };
        const result = db.delete(tasks).where(eq(tasks.id, id)).run();
        if (result.changes > 0) taskByteCache.delete(id);
        return { deleted: result.changes > 0, existing };
      },
      async appendTerminalLog(taskId, chunk) {
        getDb();
        const sqlite = getSqlite();
        const { insert, sumBytes, evict } = getLogStmts();
        const id = newId("tl");
        const chunkBytes = Buffer.byteLength(chunk, "utf8");
        sqlite.transaction((tid: string, c: string) => {
          insert.run(id, tid, c, Date.now());
          let stats = taskByteCache.get(tid);
          if (!stats) {
            stats = sumBytes.get(tid) as { total: number; n: number };
            taskByteCache.set(tid, stats);
          } else {
            stats.total += chunkBytes;
            stats.n += 1;
          }
          let guard = 0;
          while (stats.total > RING_LIMIT_BYTES && stats.n > 1 && guard < 8) {
            const oversize = stats.total - RING_LIMIT_BYTES;
            const avg = Math.max(1, Math.floor(stats.total / stats.n));
            const estimate = Math.min(stats.n - 1, Math.max(1, Math.ceil(oversize / avg)));
            evict.run(tid, estimate);
            stats = sumBytes.get(tid) as { total: number; n: number };
            taskByteCache.set(tid, stats);
            guard++;
          }
        })(taskId, chunk);
      },
      async readTerminalLog(taskId) {
        return getDb()
          .select()
          .from(terminalLogs)
          .where(eq(terminalLogs.taskId, taskId))
          .orderBy(asc(terminalLogs.createdAt))
          .all()
          .map((r) => r.chunk)
          .join("");
      },
    },
    userTerminals: {
      async list(projectId) {
        return getDb()
          .select()
          .from(userTerminals)
          .where(and(eq(userTerminals.projectId, projectId), isNull(userTerminals.startCommand)))
          .orderBy(asc(userTerminals.position), asc(userTerminals.createdAt))
          .all();
      },
      async purgeLaunchSpawned(projectId) {
        const where = projectId
          ? and(eq(userTerminals.projectId, projectId), isNotNull(userTerminals.startCommand))
          : isNotNull(userTerminals.startCommand);
        return getDb().delete(userTerminals).where(where).run().changes ?? 0;
      },
      async create(input) {
        const db = getDb();
        const exists = db.select({ id: projects.id }).from(projects).where(eq(projects.id, input.projectId)).get();
        if (!exists) throw new Error("Project does not exist");
        const now = Date.now();
        const startCommand = input.startCommand?.trim() || null;
        const trimmedName = input.name?.trim();
        const id = newUuidId("ut");
        let name = trimmedName;
        if (!name) {
          const rows = db
            .select({ name: userTerminals.name })
            .from(userTerminals)
            .where(eq(userTerminals.projectId, input.projectId))
            .all();
          const used = new Set(rows.map((row) => row.name));
          let i = 1;
          do {
            name = `Terminal ${i++}`;
          } while (used.has(name));
        }
        return db
          .insert(userTerminals)
          .values({
            id,
            projectId: input.projectId,
            name,
            cwd: input.cwd ?? null,
            startCommand,
            position: sql<number>`COALESCE((SELECT MAX(${userTerminals.position}) + 1 FROM ${userTerminals} WHERE ${userTerminals.projectId} = ${input.projectId}), 0)` as unknown as number,
            createdAt: now,
            updatedAt: now,
          })
          .returning()
          .get();
      },
      async rename(id, name) {
        return getDb().update(userTerminals).set({ name: name.trim(), updatedAt: Date.now() }).where(eq(userTerminals.id, id)).returning().get() ?? null;
      },
      async delete(id) {
        const db = getDb();
        const existing = db.select({ projectId: userTerminals.projectId }).from(userTerminals).where(eq(userTerminals.id, id)).get();
        const result = db.delete(userTerminals).where(eq(userTerminals.id, id)).run();
        return { deleted: result.changes > 0, projectId: existing?.projectId ?? null };
      },
      async getProjectId(id) {
        return (
          getDb()
            .select({ projectId: userTerminals.projectId })
            .from(userTerminals)
            .where(eq(userTerminals.id, id))
            .get()?.projectId ?? null
        );
      },
    },
    settings: {
      async get(key) {
        return getDb().select().from(appSettings).where(eq(appSettings.key, key)).get()?.value ?? null;
      },
      async set(key, value) {
        getDb()
          .insert(appSettings)
          .values({ key, value })
          .onConflictDoUpdate({ target: appSettings.key, set: { value } })
          .run();
      },
      async delete(key) {
        getDb().delete(appSettings).where(eq(appSettings.key, key)).run();
      },
    },
    usage: {
      async syncTokenUsage() {
        return 0;
      },
      async getUsageSummary(daysBack = 30) {
        const db = getDb();
        const rollupSumCols = {
          inputTokens: sql<number>`COALESCE(SUM(${tokenUsageDailyRollup.inputTokens}), 0)`.as("input_tokens"),
          outputTokens: sql<number>`COALESCE(SUM(${tokenUsageDailyRollup.outputTokens}), 0)`.as("output_tokens"),
          cacheCreationTokens: sql<number>`COALESCE(SUM(${tokenUsageDailyRollup.cacheCreationTokens}), 0)`.as("cache_creation_tokens"),
          cacheReadTokens: sql<number>`COALESCE(SUM(${tokenUsageDailyRollup.cacheReadTokens}), 0)`.as("cache_read_tokens"),
        };
        const sumCols = {
          inputTokens: sql<number>`COALESCE(SUM(${tokenUsage.inputTokens}), 0)`.as("input_tokens"),
          outputTokens: sql<number>`COALESCE(SUM(${tokenUsage.outputTokens}), 0)`.as("output_tokens"),
          cacheCreationTokens: sql<number>`COALESCE(SUM(${tokenUsage.cacheCreationTokens}), 0)`.as("cache_creation_tokens"),
          cacheReadTokens: sql<number>`COALESCE(SUM(${tokenUsage.cacheReadTokens}), 0)`.as("cache_read_tokens"),
        };
        const totalsRow = db.select(rollupSumCols).from(tokenUsageDailyRollup).get();
        const totals: TokenTotals = totalsRow
          ? {
              inputTokens: Number(totalsRow.inputTokens) || 0,
              outputTokens: Number(totalsRow.outputTokens) || 0,
              cacheCreationTokens: Number(totalsRow.cacheCreationTokens) || 0,
              cacheReadTokens: Number(totalsRow.cacheReadTokens) || 0,
            }
          : { ...EMPTY_TOTALS };
        const perProjectRows = db
          .select({ projectId: projects.id, name: projects.name, icon: projects.icon, iconColor: projects.iconColor, ...rollupSumCols })
          .from(tokenUsageDailyRollup)
          .innerJoin(projects, eq(projects.id, tokenUsageDailyRollup.projectId))
          .groupBy(projects.id)
          .all();
        const perProject: ProjectUsage[] = perProjectRows
          .map((r) => ({
            projectId: r.projectId,
            name: r.name,
            icon: r.icon,
            iconColor: r.iconColor,
            inputTokens: Number(r.inputTokens) || 0,
            outputTokens: Number(r.outputTokens) || 0,
            cacheCreationTokens: Number(r.cacheCreationTokens) || 0,
            cacheReadTokens: Number(r.cacheReadTokens) || 0,
          }))
          .sort((a, b) => totalOf(b) - totalOf(a));
        const sinceDay = formatLocalDay(new Date(Date.now() - (daysBack - 1) * 86_400_000));
        const perDayRows = db
          .select({ day: tokenUsageDailyRollup.day, ...rollupSumCols })
          .from(tokenUsageDailyRollup)
          .where(gte(tokenUsageDailyRollup.day, sinceDay))
          .groupBy(tokenUsageDailyRollup.day)
          .all();
        const dayMap = new Map<string, DailyUsage>();
        for (const r of perDayRows) dayMap.set(r.day as string, { day: r.day as string, inputTokens: Number(r.inputTokens) || 0, outputTokens: Number(r.outputTokens) || 0, cacheCreationTokens: Number(r.cacheCreationTokens) || 0, cacheReadTokens: Number(r.cacheReadTokens) || 0 });
        const perDay: DailyUsage[] = [];
        for (let i = daysBack - 1; i >= 0; i--) {
          const key = formatLocalDay(new Date(Date.now() - i * 86_400_000));
          perDay.push(dayMap.get(key) ?? { day: key, ...EMPTY_TOTALS });
        }
        const perSessionRows = db
          .select({ taskId: tokenUsage.taskId, title: tasks.title, projectId: tasks.projectId, projectName: projects.name, lastTs: sql<number>`MAX(${tokenUsage.ts})`.as("last_ts"), ...sumCols })
          .from(tokenUsage)
          .innerJoin(tasks, eq(tasks.id, tokenUsage.taskId))
          .innerJoin(projects, eq(projects.id, tasks.projectId))
          .groupBy(tokenUsage.taskId)
          .all();
        const perSession: SessionUsage[] = perSessionRows
          .map((r) => ({ taskId: r.taskId, title: r.title, projectId: r.projectId, projectName: r.projectName, lastTs: r.lastTs ? Number(r.lastTs) : null, inputTokens: Number(r.inputTokens) || 0, outputTokens: Number(r.outputTokens) || 0, cacheCreationTokens: Number(r.cacheCreationTokens) || 0, cacheReadTokens: Number(r.cacheReadTokens) || 0 }))
          .sort((a, b) => totalOf(b) - totalOf(a));
        return { totals, perProject, perDay, perSession, lastSyncedAt: getLastSyncedAt(), ingested: 0 };
      },
      resetSyncSingleton() {},
    },
  };
}

export { isUniqueConstraintError };
