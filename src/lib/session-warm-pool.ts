import type { Project, Task } from "~/db/schema";
import type { TaskAgent } from "~/shared/domain";
import { DEFAULT_BRANCH } from "~/shared/domain";
import { agentSupportsSkipPermissions } from "~/shared/agents";
import { newClientId } from "~/shared/client-id";
import { newSessionId } from "~/lib/agent-command";
import { commandForTask } from "~/lib/terminal-store";
import { getElectron } from "~/lib/electron";
import { api, resolveApiToken } from "~/lib/api";
import { isDockerSandboxRuntime } from "~/lib/sandbox-runtime";
import { getTerminalColorScheme } from "~/lib/terminal-options";
import { TITLE_WAITING } from "~/lib/task-sentinels";
import { normalizePtySize } from "~/shared/pty-size";

type ScopedProject = Project & { activeWorktreeId?: string | null };
export type SessionCreatePayload = {
  agent: TaskAgent;
  branch: string;
  skipPermissions: boolean;
  bareSession: boolean;
};

export type SessionWarmSlot = {
  signature: string;
  clientTaskId: string;
  ptyId: string;
  draftTask: Task;
  payload: SessionCreatePayload;
};

let warmSlot: SessionWarmSlot | null = null;
let warmPreparing: Promise<SessionWarmSlot | null> | null = null;
let warmGeneration = 0;

export function sessionCreateSignature(payload: SessionCreatePayload, cwd: string): string {
  return [
    cwd,
    payload.agent,
    payload.branch,
    payload.skipPermissions ? "1" : "0",
    payload.bareSession ? "1" : "0",
  ].join("\0");
}

async function resolveMcEnv(
  electron: NonNullable<ReturnType<typeof getElectron>>,
): Promise<{ apiUrl: string; token: string } | undefined> {
  try {
    const [port, token] = await Promise.all([
      electron.getRuntimePort(),
      resolveApiToken(),
    ]);
    if (!port || !token) return undefined;
    return { apiUrl: `http://127.0.0.1:${port}`, token };
  } catch {
    return undefined;
  }
}

function buildDraftTask(
  clientTaskId: string,
  project: ScopedProject,
  payload: SessionCreatePayload,
  claudeSessionId: string | null,
): Task {
  const now = Date.now();
  return {
    id: clientTaskId,
    projectId: project.id,
    worktreeId: project.activeWorktreeId ?? null,
    title: TITLE_WAITING,
    icon: null,
    agent: payload.agent,
    status: "ready",
    branch: payload.branch || DEFAULT_BRANCH,
    preview: "",
    lines: 0,
    archived: false,
    claudeSessionId,
    claudeSkipPermissions: agentSupportsSkipPermissions(payload.agent)
      ? payload.skipPermissions
      : false,
    claudeBareSession: payload.agent === "claude-code" ? payload.bareSession : false,
    createdAt: now,
    updatedAt: now,
  };
}

export function defaultSessionPayload(project: {
  branch: string;
  rememberAgentSettings?: boolean;
  savedAgent?: TaskAgent | null;
  savedSkipPermissions?: boolean;
  savedBareSession?: boolean;
}): SessionCreatePayload {
  const agent = project.savedAgent ?? "claude-code";
  return {
    agent,
    branch: project.branch || DEFAULT_BRANCH,
    skipPermissions: !!project.savedSkipPermissions,
    bareSession:
      project.rememberAgentSettings && project.savedAgent === "claude-code"
        ? !!project.savedBareSession
        : false,
  };
}

export async function discardSessionWarmSlot(): Promise<void> {
  warmGeneration += 1;
  warmPreparing = null;
  const slot = warmSlot;
  warmSlot = null;
  const electron = getElectron();
  if (slot && electron) {
    await electron.pty.kill(slot.ptyId).catch(() => undefined);
  }
}

async function discardSessionWarmSlotQuiet(): Promise<void> {
  warmPreparing = null;
  const slot = warmSlot;
  warmSlot = null;
  const electron = getElectron();
  if (slot && electron) {
    await electron.pty.kill(slot.ptyId).catch(() => undefined);
  }
}

export function peekSessionWarmSlot(
  payload: SessionCreatePayload,
  cwd: string,
): SessionWarmSlot | null {
  const slot = warmSlot;
  if (!slot) return null;
  return slot.signature === sessionCreateSignature(payload, cwd) ? slot : null;
}

export function takeSessionWarmSlot(
  payload: SessionCreatePayload,
  cwd: string,
): SessionWarmSlot | null {
  const slot = peekSessionWarmSlot(payload, cwd);
  if (!slot) return null;
  warmSlot = null;
  return slot;
}

export async function prepareSessionWarmSlot(input: {
  project: ScopedProject;
  payload: SessionCreatePayload;
}): Promise<SessionWarmSlot | null> {
  const electron = getElectron();
  if (!electron || !input.project.path) return null;
  if (await isDockerSandboxRuntime(electron)) {
    await discardSessionWarmSlotQuiet();
    return null;
  }

  const signature = sessionCreateSignature(input.payload, input.project.path);
  if (warmSlot?.signature === signature) return warmSlot;

  warmGeneration += 1;
  const generation = warmGeneration;
  warmPreparing = (async () => {
    await discardSessionWarmSlotQuiet();
    if (generation !== warmGeneration) return null;

    const usesPersistedSession =
      input.payload.agent === "claude-code" || input.payload.agent === "cursor-cli";
    const claudeSessionId = usesPersistedSession ? newSessionId() : null;
    const clientTaskId = newClientId("t");
    const draftTask = buildDraftTask(
      clientTaskId,
      input.project,
      input.payload,
      claudeSessionId,
    );

    try {
      const mcEnv = await resolveMcEnv(electron);
      if (generation !== warmGeneration) return null;

      const { ptyId } = await electron.pty.spawn({
        taskId: clientTaskId,
        cwd: input.project.path,
        command: commandForTask(draftTask),
        cols: normalizePtySize({ cols: 100, rows: 30 }).cols,
        rows: normalizePtySize({ cols: 100, rows: 30 }).rows,
        agent: draftTask.agent,
        dangerouslySkipPermissions: draftTask.claudeSkipPermissions,
        mcEnv,
        missionControlTheme: getTerminalColorScheme(),
      });
      if (generation !== warmGeneration) {
        await electron.pty.kill(ptyId).catch(() => undefined);
        return null;
      }

      const slot: SessionWarmSlot = {
        signature,
        clientTaskId,
        ptyId,
        draftTask,
        payload: input.payload,
      };
      warmSlot = slot;
      return slot;
    } catch {
      return null;
    } finally {
      warmPreparing = null;
    }
  })();

  return warmPreparing;
}

export function replenishSessionWarmSlot(input: {
  project: ScopedProject;
  payload: SessionCreatePayload;
}) {
  void prepareSessionWarmSlot(input);
}

/** Persist a claimed warm slot task row using the ids the PTY was already started with. */
export async function persistWarmSlotTask(
  projectId: string,
  slot: SessionWarmSlot,
  worktreeId: string | null,
): Promise<Task> {
  const { task } = await api.createTaskInternal(projectId, {
    id: slot.clientTaskId,
    title: TITLE_WAITING,
    agent: slot.payload.agent,
    branch: slot.payload.branch,
    claudeSessionId: slot.draftTask.claudeSessionId,
    claudeBareSession:
      slot.payload.agent === "claude-code" ? slot.payload.bareSession : undefined,
    claudeSkipPermissions: agentSupportsSkipPermissions(slot.payload.agent)
      ? slot.payload.skipPermissions
      : undefined,
    worktreeId,
  });
  return task;
}
