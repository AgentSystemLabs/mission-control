import { randomBytes } from "node:crypto";
import { promises as fsp } from "node:fs";
import * as path from "node:path";
import { DEFAULT_BRANCH, TASK_STATUSES, isActiveStatus } from "~/shared/domain";
import type { TaskStatus } from "~/shared/domain";
import type { Project } from "~/db/schema";
import type { ProjectWithCounts } from "~/shared/projects";

export class ProjectCapExceededError extends Error {
  constructor(
    public readonly limit: number,
    public readonly current: number,
  ) {
    super(
      `Mission Control Lite is limited to ${limit} projects. Upgrade to Pro for unlimited projects.`,
    );
    this.name = "ProjectCapExceededError";
  }
}

export class DuplicateProjectPathError extends Error {
  constructor(public readonly path: string) {
    super("A project for this working directory already exists.");
    this.name = "DuplicateProjectPathError";
  }
}

export function isUniqueConstraintError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { code?: string; message?: string };
  return (
    e.code === "SQLITE_CONSTRAINT_UNIQUE" ||
    e.code === "SQLITE_CONSTRAINT_PRIMARYKEY" ||
    (typeof e.message === "string" && /UNIQUE constraint failed/i.test(e.message))
  );
}

export async function detectGithubUrl(dir: string): Promise<string | null> {
  try {
    const cfg = path.join(dir, ".git", "config");
    let text: string;
    try {
      text = await fsp.readFile(cfg, "utf8");
    } catch {
      return null;
    }
    const m = text.match(/\[remote "origin"\][^[]*?url\s*=\s*(\S+)/);
    if (!m) return null;
    const url = m[1].trim();
    // git@github.com:owner/repo(.git)
    const ssh = url.match(/^git@github\.com:([^/]+\/[^/\s]+?)(?:\.git)?$/);
    if (ssh) return `https://github.com/${ssh[1]}`;
    // ssh://git@github.com/owner/repo(.git) or https://github.com/owner/repo(.git)
    const https = url.match(/^(?:https?|ssh):\/\/(?:[^@]+@)?github\.com\/([^/]+\/[^/\s]+?)(?:\.git)?$/);
    if (https) return `https://github.com/${https[1]}`;
    return null;
  } catch {
    return null;
  }
}

export function newId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`;
}

export async function detectBranch(dir: string): Promise<string> {
  try {
    const headFile = path.join(dir, ".git", "HEAD");
    let content: string;
    try {
      content = (await fsp.readFile(headFile, "utf8")).trim();
    } catch {
      return DEFAULT_BRANCH;
    }
    if (content.startsWith("ref: refs/heads/")) return content.replace("ref: refs/heads/", "");
    return content.slice(0, 7);
  } catch {
    return DEFAULT_BRANCH;
  }
}

export type Counts = Record<TaskStatus, number> & { total: number; activeNonDone: number };

export function emptyCounts(): Counts {
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

export { isActiveStatus };

export async function decorateRow(
  p: Project,
  taskCounts: Counts,
  preview: string | null,
): Promise<ProjectWithCounts> {
  return {
    ...p,
    taskCounts,
    preview,
    githubUrl: await detectGithubUrl(p.path),
  };
}
