import type { UserTerminal } from "~/db/schema";
import { events } from "../events";
import { getRepositories } from "../repositories";
import { isUniqueConstraintError as isSqliteUniqueConstraintError } from "../repositories/sqlite";
import { isUniqueConstraintError as isPostgresUniqueConstraintError } from "../repositories/postgres";

export class DuplicateUserTerminalNameError extends Error {
  constructor(public readonly projectId: string, public readonly name: string) {
    super(`A terminal named "${name}" already exists for this project.`);
    this.name = "DuplicateUserTerminalNameError";
  }
}

const transientTerminalProjectIds = new Map<string, string>();

function isUniqueConstraintError(err: unknown): boolean {
  return isSqliteUniqueConstraintError(err) || isPostgresUniqueConstraintError(err);
}

/** Read-only listing. Use {@link purgeLaunchSpawnedTerminals} for the cleanup
 * side effect that used to live here. */
export async function listUserTerminals(projectId: string): Promise<UserTerminal[]> {
  return getRepositories().userTerminals.list(projectId);
}

/**
 * Drop launch-spawned user terminals (rows with a non-null start_command) so
 * the next render doesn't respawn the command and pretend the run survived a
 * restart. Pass a project id to scope, or omit to purge across all projects
 * (used at app boot).
 */
export async function purgeLaunchSpawnedTerminals(projectId?: string): Promise<number> {
  for (const [id, ownerProjectId] of transientTerminalProjectIds) {
    if (!projectId || ownerProjectId === projectId) transientTerminalProjectIds.delete(id);
  }
  return getRepositories().userTerminals.purgeLaunchSpawned(projectId);
}

export async function createUserTerminal(input: {
  projectId: string;
  name?: string;
  cwd?: string | null;
  startCommand?: string | null;
}): Promise<UserTerminal> {
  const hasExplicitName = !!input.name?.trim();
  try {
    const terminal = await getRepositories().userTerminals.create(input);
    if (input.startCommand?.trim()) {
      transientTerminalProjectIds.set(terminal.id, terminal.projectId);
    }
    return terminal;
  } catch (err) {
    if (isUniqueConstraintError(err)) {
      if (!hasExplicitName) {
        for (let i = 1; i <= 100; i++) {
          try {
            return await getRepositories().userTerminals.create({
              ...input,
              name: `Terminal ${i}`,
            });
          } catch (retryErr) {
            if (!isUniqueConstraintError(retryErr)) throw retryErr;
          }
        }
      }
      throw new DuplicateUserTerminalNameError(input.projectId, input.name?.trim() || "Terminal");
    }
    throw err;
  }
}

export async function renameUserTerminal(id: string, name: string): Promise<UserTerminal | null> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Name is required");
  try {
    return await getRepositories().userTerminals.rename(id, trimmed);
  } catch (err) {
    if (isUniqueConstraintError(err)) {
      throw new DuplicateUserTerminalNameError("", trimmed);
    }
    throw err;
  }
}

export async function deleteUserTerminal(id: string): Promise<boolean> {
  const hadTransientTerminal = transientTerminalProjectIds.delete(id);
  const result = await getRepositories().userTerminals.delete(id);
  if (result.deleted) {
    // Emit so the live PTY shuts down — mirrors deleteProject's per-terminal emit.
    events.emit("user-terminal:deleted", {
      id,
      projectId: result.projectId ?? "",
    });
    return true;
  }
  return hadTransientTerminal;
}

export async function getUserTerminalProjectId(id: string): Promise<string | null> {
  return (await getRepositories().userTerminals.getProjectId(id)) ?? transientTerminalProjectIds.get(id) ?? null;
}
