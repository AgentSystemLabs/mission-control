import path from "node:path";
import { DEFAULT_BRANCH, DEFAULT_TASK_STATUS, TASK_STATUSES, isActiveStatus, isTaskAgent, isTaskStatus } from "~/shared/domain";
import { hostedWorkspacePath, normalizeHostedWorkspacePath } from "~/shared/hosted-workspace";
import type { LaunchCommand, TaskAgent, TaskStatus } from "~/shared/domain";
import type { Project, Task } from "~/db/schema";
import type { ProjectWithCounts } from "~/shared/projects";
import type { HostedAuthContext } from "../hosted-auth-context";
import { getHostedPool } from "../hosted-pg";
import { events, scopeForHostedContext, type AppEventScope } from "../events";
import { ValidationError } from "../errors";
import { newId } from "./_ids";
import { hostedGroupExists } from "./hosted-groups";
import {
  deleteRemoteSandboxesForProject,
  deleteRemoteSandboxesForTask,
  ensureRemoteProjectRepository,
  killRemotePtysForProject,
  killRemotePtysForTask,
} from "./daytona-remote-pty";
import { enqueueHostedProjectCleanup } from "./hosted-cleanup-outbox";
import { enforceHostedPlanLimit } from "./hosted-plan-limits";
import { getPinnedProjects, nextPinnedOrder, validatePinnedReorder } from "~/lib/pinned-project-order";

type HostedProjectRow = {
  id: string;
  name: string;
  groupId: string | null;
  remoteSandboxId: string | null;
  remotePath: string | null;
  githubUrl: string | null;
  branch: string;
  icon: string;
  iconColor: string;
  imagePath: string | null;
  pinned: boolean;
  pinnedOrder: number | null;
  launchCommands: unknown;
  launchUrl: string | null;
  rememberAgentSettings: boolean;
  savedAgent: TaskAgent | null;
  savedSkipPermissions: boolean;
  savedBareSession: boolean;
  createdAt: Date | string | number;
  updatedAt: Date | string | number;
};

type HostedTaskRow = {
  id: string;
  projectId: string;
  title: string;
  icon: string | null;
  agent: TaskAgent;
  status: TaskStatus;
  branch: string;
  preview: string;
  lines: number;
  archived: boolean;
  claudeSessionId: string | null;
  claudeSkipPermissions: boolean;
  claudeBareSession: boolean;
  createdAt: Date | string | number;
  updatedAt: Date | string | number;
};

type HostedTaskScopeRow = {
  organizationId: string | null;
  ownerUserId: string | null;
};

function scopeParams(context: HostedAuthContext): [string | null, string] {
  return [context.organizationId, context.userId];
}

function eventScopeForContext(context: HostedAuthContext): AppEventScope {
  return scopeForHostedContext(context);
}

function eventScopeFromRow(row: HostedTaskScopeRow | undefined): AppEventScope | null {
  if (!row) return null;
  return {
    organizationId: row.organizationId,
    userId: row.organizationId ? null : row.ownerUserId,
  };
}

export async function eventScopeForHostedTask(taskId: string): Promise<AppEventScope | null> {
  const result = await getHostedPool().query<HostedTaskScopeRow>(
    `SELECT "hostedProject"."organizationId", "hostedProject"."ownerUserId"
      FROM "hostedTask"
      INNER JOIN "hostedProject" ON "hostedProject"."id" = "hostedTask"."projectId"
      WHERE "hostedTask"."id" = $1
      LIMIT 1`,
    [taskId],
  );
  return eventScopeFromRow(result.rows[0]);
}

function scopedProjectWhere(alias = '"hostedProject"') {
  return `(
    ($1::text IS NOT NULL AND ${alias}."organizationId" = $1)
    OR (
      $1::text IS NULL
      AND ${alias}."organizationId" IS NULL
      AND ${alias}."ownerUserId" = $2
    )
  )`;
}

function toMillis(value: Date | string | number): number {
  if (typeof value === "number") return value;
  if (value instanceof Date) return value.getTime();
  return new Date(value).getTime();
}

function launchCommandsToString(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

function serializeLaunchCommands(input: LaunchCommand[] | null | undefined): unknown {
  if (input == null) return null;
  if (!Array.isArray(input)) throw new ValidationError("launchCommands must be an array");
  return input.map((command) => {
    const id = String(command?.id ?? "").trim();
    const name = String(command?.name ?? "").trim();
    const raw = String(command?.command ?? "").trim();
    if (!id) throw new ValidationError("launchCommands: id is required");
    if (!name) throw new ValidationError("launchCommands: name is required");
    if (!raw) throw new ValidationError("launchCommands: command is required");
    return { id, name, command: raw };
  });
}

function hasOwn<T extends object>(value: T, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

async function validateHostedGroupId(
  context: HostedAuthContext,
  groupId: string | null,
): Promise<void> {
  if (!groupId) return;
  if (!(await hostedGroupExists(context, groupId))) {
    throw new ValidationError("group not found");
  }
}

type NormalizedGithubRepository = {
  url: string;
  repo: string;
};

function normalizeGithubRepositoryUrl(value: string): NormalizedGithubRepository {
  const trimmed = value.trim();
  const match =
    trimmed.match(/^git@github\.com:([^/\s]+)\/([^/\s?#]+?)(?:\.git)?$/i) ??
    trimmed.match(/^ssh:\/\/git@github\.com\/([^/\s]+)\/([^/\s?#]+?)(?:\.git)?(?:[/?#].*)?$/i) ??
    trimmed.match(/^https?:\/\/github\.com\/([^/\s]+)\/([^/\s?#]+?)(?:\.git)?(?:[/?#].*)?$/i);
  if (!match) throw new ValidationError("Enter a valid GitHub repository URL");
  const owner = match[1];
  const repo = match[2].replace(/\.git$/i, "");
  const validSegment = /^[A-Za-z0-9._-]+$/;
  if (!validSegment.test(owner) || !validSegment.test(repo)) {
    throw new ValidationError("Enter a valid GitHub repository URL");
  }
  return { url: `https://github.com/${owner}/${repo}`, repo };
}

function mapProject(row: HostedProjectRow): Project {
  const name = row.name || "project";
  return {
    id: row.id,
    name,
    path: normalizeHostedWorkspacePath(row.remotePath) || hostedWorkspacePath(name),
    icon: row.icon || name.slice(0, 2).toUpperCase(),
    iconColor: row.iconColor || "#ff5a1f",
    imagePath: row.imagePath,
    groupId: row.groupId,
    // Hosted (web/Daytona) projects have no local-sandbox scope.
    sandboxId: null,
    pinned: !!row.pinned,
    pinnedOrder: row.pinnedOrder ?? null,
    branch: row.branch || DEFAULT_BRANCH,
    launchCommands: launchCommandsToString(row.launchCommands),
    launchUrl: row.launchUrl,
    worktreeSetupCommand: null,
    rememberAgentSettings: !!row.rememberAgentSettings,
    savedAgent: row.savedAgent,
    savedSkipPermissions: !!row.savedSkipPermissions,
    savedBareSession: !!row.savedBareSession,
    createdAt: toMillis(row.createdAt),
    updatedAt: toMillis(row.updatedAt),
  };
}

function mapTask(row: HostedTaskRow): Task {
  return {
    id: row.id,
    projectId: row.projectId,
    worktreeId: null,
    title: row.title,
    icon: row.icon,
    agent: row.agent,
    status: row.status,
    branch: row.branch,
    preview: row.preview,
    lines: row.lines,
    archived: !!row.archived,
    claudeSessionId: row.claudeSessionId,
    claudeSkipPermissions: !!row.claudeSkipPermissions,
    claudeBareSession: !!row.claudeBareSession,
    createdAt: toMillis(row.createdAt),
    updatedAt: toMillis(row.updatedAt),
  };
}

function decorate(project: Project, tasks: Task[], githubUrl: string | null): ProjectWithCounts {
  const active = tasks.filter((task) => !task.archived);
  const counts = TASK_STATUSES.reduce(
    (acc, status) => {
      acc[status] = 0;
      return acc;
    },
    {} as Record<TaskStatus, number>,
  );
  let activeNonDone = 0;
  for (const task of active) {
    counts[task.status]++;
    if (isActiveStatus(task.status) && task.status !== "finished") activeNonDone++;
  }
  const previewSource =
    active.find((task) => task.status === "running") ??
    active.find((task) => task.status === "needs-input");
  return {
    ...project,
    taskCounts: { ...counts, total: active.length, activeNonDone },
    preview: previewSource?.preview ?? null,
    githubUrl,
  };
}

export async function listHostedProjects(context: HostedAuthContext): Promise<ProjectWithCounts[]> {
  const params = scopeParams(context);
  const projects = await getHostedPool().query<HostedProjectRow>(
    `SELECT * FROM "hostedProject"
      WHERE ${scopedProjectWhere()}
      ORDER BY "createdAt" ASC`,
    params,
  );
  const tasks = await getHostedPool().query<HostedTaskRow>(
    `SELECT "hostedTask".* FROM "hostedTask"
      INNER JOIN "hostedProject" ON "hostedProject"."id" = "hostedTask"."projectId"
      WHERE ${scopedProjectWhere()}
      ORDER BY "hostedTask"."createdAt" DESC`,
    params,
  );
  const tasksByProject = new Map<string, Task[]>();
  for (const row of tasks.rows) {
    const task = mapTask(row);
    tasksByProject.set(task.projectId, [...(tasksByProject.get(task.projectId) ?? []), task]);
  }
  return projects.rows.map((row) =>
    decorate(mapProject(row), tasksByProject.get(row.id) ?? [], row.githubUrl),
  );
}

export async function getHostedProject(
  context: HostedAuthContext,
  id: string,
): Promise<ProjectWithCounts | null> {
  const params = [...scopeParams(context), id];
  const project = await getHostedPool().query<HostedProjectRow>(
    `SELECT * FROM "hostedProject"
      WHERE ${scopedProjectWhere()} AND "id" = $3
      LIMIT 1`,
    params,
  );
  const row = project.rows[0];
  if (!row) return null;
  const tasks = await listHostedTasksForProject(context, id);
  return decorate(mapProject(row), tasks, row.githubUrl);
}

export async function createHostedProject(
  context: HostedAuthContext,
  input: {
    name?: string;
    path?: string;
    githubUrl?: string;
    icon?: string;
    iconColor?: string;
    groupId?: string | null;
  },
): Promise<Project> {
  const github = input.githubUrl?.trim()
    ? normalizeGithubRepositoryUrl(input.githubUrl)
    : null;
  const remotePath = normalizeHostedWorkspacePath(github
    ? hostedWorkspacePath(github.repo)
    : input.path?.trim());
  if (!remotePath) throw new ValidationError("Working directory is required");
  const name = input.name?.trim() || github?.repo || path.posix.basename(remotePath) || "project";
  const groupId = input.groupId ?? null;
  await validateHostedGroupId(context, groupId);
  await enforceHostedPlanLimit(context, "projects");
  const id = newId("hp");
  let remoteSandboxId: string | null = null;
  let branch = DEFAULT_BRANCH;
  if (github) {
    const cloned = await ensureRemoteProjectRepository({
      context,
      projectId: id,
      path: remotePath,
      githubUrl: github.url,
    });
    remoteSandboxId = cloned.sandboxId;
    branch = cloned.branch || DEFAULT_BRANCH;
  }
  const params = [
    id,
    context.organizationId,
    context.organizationId ? null : context.userId,
    name,
    remoteSandboxId,
    remotePath,
    github?.url ?? null,
    branch,
    input.icon || name.slice(0, 2).toUpperCase().slice(0, 2),
    input.iconColor || "#ff5a1f",
    groupId,
  ];
  const result = await getHostedPool().query<HostedProjectRow>(
    `INSERT INTO "hostedProject" (
        "id", "organizationId", "ownerUserId", "name", "runtime", "remoteProvider",
        "remoteSandboxId", "remotePath", "githubUrl", "branch", "icon", "iconColor", "groupId"
      )
      VALUES ($1, $2, $3, $4, 'daytona', 'daytona', $5, $6, $7, $8, $9, $10, $11)
      RETURNING *`,
    params,
  );
  events.emit("project:created", { id, scope: eventScopeForContext(context) });
  return mapProject(result.rows[0]!);
}

export async function updateHostedProject(
  context: HostedAuthContext,
  id: string,
  patch: Partial<
    Pick<
      Project,
      | "name"
      | "path"
      | "icon"
      | "iconColor"
      | "imagePath"
      | "groupId"
      | "pinned"
      | "pinnedOrder"
      | "branch"
      | "launchUrl"
      | "rememberAgentSettings"
      | "savedAgent"
      | "savedSkipPermissions"
      | "savedBareSession"
    >
  > & { launchCommands?: LaunchCommand[] | null },
): Promise<Project | null> {
  const existing = await getHostedProject(context, id);
  if (!existing) return null;
  const groupId = hasOwn(patch, "groupId") ? patch.groupId ?? null : existing.groupId;
  await validateHostedGroupId(context, groupId);
  const pinning = hasOwn(patch, "pinned") ? !!patch.pinned : existing.pinned;
  const next = {
    name: patch.name ?? existing.name,
    remotePath: normalizeHostedWorkspacePath(patch.path ?? existing.path),
    icon: patch.icon ?? existing.icon,
    iconColor: patch.iconColor ?? existing.iconColor,
    imagePath: hasOwn(patch, "imagePath") ? patch.imagePath ?? null : existing.imagePath,
    groupId,
    pinned: pinning,
    pinnedOrder: pinning
      ? hasOwn(patch, "pinnedOrder")
        ? patch.pinnedOrder ?? null
        : existing.pinnedOrder ?? nextPinnedOrder((await listHostedProjects(context)).filter((p) => p.id !== id))
      : null,
    branch: patch.branch ?? existing.branch,
    launchCommands:
      patch.launchCommands === undefined
        ? existing.launchCommands
          ? JSON.parse(existing.launchCommands)
          : null
        : serializeLaunchCommands(patch.launchCommands),
    launchUrl: hasOwn(patch, "launchUrl") ? patch.launchUrl ?? null : existing.launchUrl,
    rememberAgentSettings: patch.rememberAgentSettings ?? existing.rememberAgentSettings,
    savedAgent: hasOwn(patch, "savedAgent") ? patch.savedAgent ?? null : existing.savedAgent,
    savedSkipPermissions: patch.savedSkipPermissions ?? existing.savedSkipPermissions,
    savedBareSession: patch.savedBareSession ?? existing.savedBareSession,
  };
  const params = [
    ...scopeParams(context),
    id,
    next.name,
    next.remotePath,
    next.icon,
    next.iconColor,
    next.imagePath,
    next.groupId,
    next.pinned,
    next.pinnedOrder,
    next.branch,
    JSON.stringify(next.launchCommands),
    next.launchUrl,
    next.rememberAgentSettings,
    next.savedAgent,
    next.savedSkipPermissions,
    next.savedBareSession,
  ];
  const result = await getHostedPool().query<HostedProjectRow>(
    `UPDATE "hostedProject"
      SET "name" = $4,
        "remotePath" = $5,
        "icon" = $6,
        "iconColor" = $7,
        "imagePath" = $8,
        "groupId" = $9,
        "pinned" = $10,
        "pinnedOrder" = $11,
        "branch" = $12,
        "launchCommands" = $13::jsonb,
        "launchUrl" = $14,
        "rememberAgentSettings" = $15,
        "savedAgent" = $16,
        "savedSkipPermissions" = $17,
        "savedBareSession" = $18,
        "updatedAt" = now()
      WHERE ${scopedProjectWhere()} AND "id" = $3
      RETURNING *`,
    params,
  );
  const row = result.rows[0];
  if (!row) return null;
  events.emit("project:updated", { id, scope: eventScopeForContext(context) });
  return mapProject(row);
}

export async function toggleHostedProjectPin(
  context: HostedAuthContext,
  id: string,
): Promise<Project | null> {
  const existing = await getHostedProject(context, id);
  if (!existing) return null;
  const pinning = !existing.pinned;
  const pinnedOrder = pinning
    ? nextPinnedOrder((await listHostedProjects(context)).filter((project) => project.id !== id))
    : null;
  return updateHostedProject(context, id, { pinned: pinning, pinnedOrder });
}

export async function reorderHostedPinnedProjects(
  context: HostedAuthContext,
  order: string[],
): Promise<ProjectWithCounts[]> {
  const pool = getHostedPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const current = await client.query<HostedProjectRow>(
      `SELECT * FROM "hostedProject"
        WHERE ${scopedProjectWhere()}
        ORDER BY "createdAt" ASC
        FOR UPDATE`,
      scopeParams(context),
    );
    const pinned = getPinnedProjects(current.rows.map(mapProject));
    try {
      validatePinnedReorder(order, pinned);
    } catch (error) {
      throw new ValidationError(error instanceof Error ? error.message : "invalid pinned order");
    }
    for (let index = 0; index < order.length; index++) {
      await client.query(
        `UPDATE "hostedProject"
          SET "pinnedOrder" = $4, "updatedAt" = now()
          WHERE ${scopedProjectWhere()} AND "id" = $3`,
        [...scopeParams(context), order[index]!, index],
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  const scope = eventScopeForContext(context);
  for (const id of order) {
    events.emit("project:updated", { id, scope });
  }
  return listHostedProjects(context);
}

export async function deleteHostedProject(
  context: HostedAuthContext,
  id: string,
): Promise<boolean> {
  const projectResult = await getHostedPool().query<Pick<HostedProjectRow, "remoteSandboxId">>(
    `SELECT "remoteSandboxId" FROM "hostedProject"
      WHERE ${scopedProjectWhere()} AND "id" = $3
      LIMIT 1`,
    [...scopeParams(context), id],
  );
  const project = projectResult.rows[0];
  if (!project) return false;
  try {
    await killRemotePtysForProject(context, id);
    await deleteRemoteSandboxesForProject(context, id);
  } catch (error) {
    await enqueueHostedProjectCleanup(context, id, project.remoteSandboxId, error);
  }
  const result = await getHostedPool().query(
    `DELETE FROM "hostedProject"
      WHERE ${scopedProjectWhere()} AND "id" = $3`,
    [...scopeParams(context), id],
  );
  if ((result.rowCount ?? 0) > 0) {
    events.emit("project:deleted", { id, scope: eventScopeForContext(context) });
    return true;
  }
  return false;
}

export async function listHostedTasksForProject(
  context: HostedAuthContext,
  projectId: string,
): Promise<Task[]> {
  const result = await getHostedPool().query<HostedTaskRow>(
    `SELECT "hostedTask".* FROM "hostedTask"
      INNER JOIN "hostedProject" ON "hostedProject"."id" = "hostedTask"."projectId"
      WHERE ${scopedProjectWhere()} AND "hostedTask"."projectId" = $3
      ORDER BY "hostedTask"."createdAt" DESC`,
    [...scopeParams(context), projectId],
  );
  return result.rows.map(mapTask);
}

export async function getHostedTask(
  context: HostedAuthContext,
  id: string,
): Promise<Task | null> {
  const result = await getHostedPool().query<HostedTaskRow>(
    `SELECT "hostedTask".* FROM "hostedTask"
      INNER JOIN "hostedProject" ON "hostedProject"."id" = "hostedTask"."projectId"
      WHERE ${scopedProjectWhere()} AND "hostedTask"."id" = $3
      LIMIT 1`,
    [...scopeParams(context), id],
  );
  return result.rows[0] ? mapTask(result.rows[0]) : null;
}

export async function getHostedTaskForHook(id: string): Promise<Task | null> {
  const result = await getHostedPool().query<HostedTaskRow>(
    `SELECT * FROM "hostedTask" WHERE "id" = $1 LIMIT 1`,
    [id],
  );
  return result.rows[0] ? mapTask(result.rows[0]) : null;
}

export async function createHostedTask(
  context: HostedAuthContext,
  input: {
    projectId: string;
    title: string;
    agent: TaskAgent;
    branch?: string;
    status?: TaskStatus;
    preview?: string;
    claudeSessionId?: string | null;
    claudeSkipPermissions?: boolean;
    claudeBareSession?: boolean;
  },
): Promise<Task> {
  if (!input.projectId) throw new ValidationError("projectId required");
  if (!input.title?.trim()) throw new ValidationError("title required");
  if (!isTaskAgent(input.agent)) throw new ValidationError("invalid agent");
  const project = await getHostedProject(context, input.projectId);
  if (!project) throw new ValidationError("project not found");
  await enforceHostedPlanLimit(context, "tasks");
  const id = newId("ht");
  const result = await getHostedPool().query<HostedTaskRow>(
    `INSERT INTO "hostedTask" (
        "id", "projectId", "title", "agent", "status", "branch", "preview",
        "claudeSessionId", "claudeSkipPermissions", "claudeBareSession"
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *`,
    [
      id,
      input.projectId,
      input.title.trim(),
      input.agent,
      input.status ?? DEFAULT_TASK_STATUS,
      input.branch || DEFAULT_BRANCH,
      input.preview ?? "",
      input.claudeSessionId ?? null,
      input.claudeSkipPermissions ?? false,
      input.claudeBareSession ?? false,
    ],
  );
  const task = mapTask(result.rows[0]!);
  events.emit("task:created", {
    id: task.id,
    projectId: task.projectId,
    scope: eventScopeForContext(context),
  });
  return task;
}

export async function updateHostedTaskStatus(
  context: HostedAuthContext,
  id: string,
  patch: { status?: TaskStatus; preview?: string; lines?: number },
): Promise<Task | null> {
  if (patch.status && !isTaskStatus(patch.status)) throw new ValidationError("invalid status");
  const existing = await getHostedTask(context, id);
  if (!existing) return null;
  const result = await getHostedPool().query<HostedTaskRow>(
    `UPDATE "hostedTask"
      SET "status" = $4, "preview" = $5, "lines" = $6, "updatedAt" = now()
      WHERE "id" = $3
        AND "projectId" IN (
          SELECT "id" FROM "hostedProject" WHERE ${scopedProjectWhere()}
        )
      RETURNING *`,
    [
      ...scopeParams(context),
      id,
      patch.status ?? existing.status,
      patch.preview ?? existing.preview,
      patch.lines ?? existing.lines,
    ],
  );
  const task = result.rows[0] ? mapTask(result.rows[0]) : null;
  if (task) {
    events.emit("task:updated", {
      id,
      projectId: task.projectId,
      scope: eventScopeForContext(context),
    });
  }
  return task;
}

export async function updateHostedTaskStatusForHook(
  id: string,
  patch: { status?: TaskStatus; preview?: string; lines?: number },
): Promise<Task | null> {
  if (patch.status && !isTaskStatus(patch.status)) throw new ValidationError("invalid status");
  const existing = await getHostedTaskForHook(id);
  if (!existing) return null;
  const result = await getHostedPool().query<HostedTaskRow>(
    `UPDATE "hostedTask"
      SET "status" = $2, "preview" = $3, "lines" = $4, "updatedAt" = now()
      WHERE "id" = $1
      RETURNING *`,
    [
      id,
      patch.status ?? existing.status,
      patch.preview ?? existing.preview,
      patch.lines ?? existing.lines,
    ],
  );
  const task = result.rows[0] ? mapTask(result.rows[0]) : null;
  if (task) {
    const scope = await eventScopeForHostedTask(id);
    if (scope) events.emit("task:updated", { id, projectId: task.projectId, scope });
  }
  return task;
}

export async function updateHostedTaskForHook(
  id: string,
  patch: Partial<Pick<Task, "claudeSessionId">>,
): Promise<Task | null> {
  const existing = await getHostedTaskForHook(id);
  if (!existing) return null;
  const result = await getHostedPool().query<HostedTaskRow>(
    `UPDATE "hostedTask"
      SET "claudeSessionId" = $2, "updatedAt" = now()
      WHERE "id" = $1
      RETURNING *`,
    [
      id,
      hasOwn(patch, "claudeSessionId")
        ? patch.claudeSessionId ?? null
        : existing.claudeSessionId,
    ],
  );
  const task = result.rows[0] ? mapTask(result.rows[0]) : null;
  if (task) {
    const scope = await eventScopeForHostedTask(id);
    if (scope) events.emit("task:updated", { id, projectId: task.projectId, scope });
  }
  return task;
}

export async function updateHostedTask(
  context: HostedAuthContext,
  id: string,
  patch: Partial<
    Pick<Task, "title" | "icon" | "branch" | "claudeSessionId" | "claudeSkipPermissions" | "claudeBareSession">
  >,
): Promise<Task | null> {
  const existing = await getHostedTask(context, id);
  if (!existing) return null;
  const result = await getHostedPool().query<HostedTaskRow>(
    `UPDATE "hostedTask"
      SET "title" = $4,
        "icon" = $5,
        "branch" = $6,
        "claudeSessionId" = $7,
        "claudeSkipPermissions" = $8,
        "claudeBareSession" = $9,
        "updatedAt" = now()
      WHERE "id" = $3
        AND "projectId" IN (
          SELECT "id" FROM "hostedProject" WHERE ${scopedProjectWhere()}
        )
      RETURNING *`,
    [
      ...scopeParams(context),
      id,
      patch.title ?? existing.title,
      hasOwn(patch, "icon") ? patch.icon ?? null : existing.icon,
      patch.branch ?? existing.branch,
      hasOwn(patch, "claudeSessionId")
        ? patch.claudeSessionId ?? null
        : existing.claudeSessionId,
      patch.claudeSkipPermissions ?? existing.claudeSkipPermissions,
      patch.claudeBareSession ?? existing.claudeBareSession,
    ],
  );
  const task = result.rows[0] ? mapTask(result.rows[0]) : null;
  if (task) {
    events.emit("task:updated", {
      id,
      projectId: task.projectId,
      scope: eventScopeForContext(context),
    });
  }
  return task;
}

export async function setHostedTaskArchived(
  context: HostedAuthContext,
  id: string,
  archived: boolean,
): Promise<Task | null> {
  const result = await getHostedPool().query<HostedTaskRow>(
    `UPDATE "hostedTask"
      SET "archived" = $4, "updatedAt" = now()
      WHERE "id" = $3
        AND "projectId" IN (
          SELECT "id" FROM "hostedProject" WHERE ${scopedProjectWhere()}
        )
      RETURNING *`,
    [...scopeParams(context), id, archived],
  );
  const task = result.rows[0] ? mapTask(result.rows[0]) : null;
  if (task) {
    events.emit(archived ? "task:archived" : "task:restored", {
      id,
      projectId: task.projectId,
      scope: eventScopeForContext(context),
    });
  }
  return task;
}

export async function deleteHostedTask(
  context: HostedAuthContext,
  id: string,
): Promise<boolean> {
  const existing = await getHostedTask(context, id);
  if (!existing) return false;
  await killRemotePtysForTask(context, id);
  await deleteRemoteSandboxesForTask(context, existing.projectId, id);
  const result = await getHostedPool().query(
    `DELETE FROM "hostedTask"
      WHERE "id" = $3
        AND "projectId" IN (
          SELECT "id" FROM "hostedProject" WHERE ${scopedProjectWhere()}
        )`,
    [...scopeParams(context), id],
  );
  if ((result.rowCount ?? 0) > 0) {
    events.emit("task:deleted", {
      id,
      projectId: existing.projectId,
      scope: eventScopeForContext(context),
    });
    return true;
  }
  return false;
}
