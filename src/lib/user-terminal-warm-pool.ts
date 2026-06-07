import type { UserTerminal } from "~/db/schema";
import type { ScopedProject } from "~/lib/scoped-project";
import { newClientId } from "~/shared/client-id";
import { getElectron } from "~/lib/electron";
import { prefetchTerminalModules } from "~/lib/prefetch-terminal-modules";
import { isDockerSandboxRuntime } from "~/lib/sandbox-runtime";
import { DEFAULT_PTY_COLS, DEFAULT_PTY_ROWS } from "~/shared/pty-size";
import { LOCAL_SCOPE_ID } from "~/shared/sandbox";


export type UserTerminalWarmSlot = {
  signature: string;
  clientTerminalId: string;
  ptyId: string;
  draftTerminal: UserTerminal;
  cwd: string;
};

let warmSlot: UserTerminalWarmSlot | null = null;
let warmPreparing: Promise<UserTerminalWarmSlot | null> | null = null;
let warmGeneration = 0;

/** Warm pool only covers interactive shell terminals (no launch startCommand). */
export function userTerminalWarmSignature(cwd: string, scopeId: string | null = LOCAL_SCOPE_ID): string {
  return `${scopeId || LOCAL_SCOPE_ID}\0${cwd}`;
}

function buildDraftTerminal(
  clientTerminalId: string,
  project: ScopedProject,
  cwd: string,
): UserTerminal {
  const now = Date.now();
  return {
    id: clientTerminalId,
    projectId: project.id,
    worktreeId: project.activeWorktreeId ?? null,
    scopeId: project.activeRuntimeScopeId ?? LOCAL_SCOPE_ID,
    name: "Terminal",
    cwd,
    startCommand: null,
    position: 0,
    createdAt: now,
    updatedAt: now,
  };
}

export async function discardUserTerminalWarmSlot(): Promise<void> {
  // Bump the generation so any in-flight prepare is invalidated, then tear down.
  warmGeneration += 1;
  await discardUserTerminalWarmSlotQuiet();
}

async function discardUserTerminalWarmSlotQuiet(): Promise<void> {
  warmPreparing = null;
  const slot = warmSlot;
  warmSlot = null;
  const electron = getElectron();
  if (slot && electron) {
    await electron.pty.kill(slot.ptyId).catch(() => undefined);
  }
}

export function peekUserTerminalWarmSlot(
  cwd: string,
  scopeId: string | null = LOCAL_SCOPE_ID,
): UserTerminalWarmSlot | null {
  const slot = warmSlot;
  if (!slot) return null;
  return slot.signature === userTerminalWarmSignature(cwd, scopeId) ? slot : null;
}

export function takeUserTerminalWarmSlot(
  cwd: string,
  scopeId: string | null = LOCAL_SCOPE_ID,
): UserTerminalWarmSlot | null {
  const slot = peekUserTerminalWarmSlot(cwd, scopeId);
  if (!slot) return null;
  warmSlot = null;
  return slot;
}

export async function prepareUserTerminalWarmSlot(input: {
  project: ScopedProject;
  cwd: string;
}): Promise<UserTerminalWarmSlot | null> {
  const electron = getElectron();
  if (!electron || !input.cwd) return null;
  if (await isDockerSandboxRuntime(electron)) {
    await discardUserTerminalWarmSlotQuiet();
    return null;
  }

  const signature = userTerminalWarmSignature(
    input.cwd,
    input.project.activeRuntimeScopeId ?? LOCAL_SCOPE_ID,
  );
  if (warmSlot?.signature === signature) return warmSlot;

  warmGeneration += 1;
  const generation = warmGeneration;
  warmPreparing = (async () => {
    await discardUserTerminalWarmSlotQuiet();
    if (generation !== warmGeneration) return null;

    void prefetchTerminalModules();

    const clientTerminalId = newClientId("ut");
    const draftTerminal = buildDraftTerminal(clientTerminalId, input.project, input.cwd);
    const ptySize = { cols: DEFAULT_PTY_COLS, rows: DEFAULT_PTY_ROWS };

    try {
      const { ptyId } = await electron.pty.spawn({
        taskId: clientTerminalId,
        cwd: input.cwd,
        command: "",
        cols: ptySize.cols,
        rows: ptySize.rows,
        shell: true,
      });
      if (generation !== warmGeneration) {
        await electron.pty.kill(ptyId).catch(() => undefined);
        return null;
      }

      const slot: UserTerminalWarmSlot = {
        signature,
        clientTerminalId,
        ptyId,
        draftTerminal,
        cwd: input.cwd,
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

export function replenishUserTerminalWarmSlot(input: {
  project: ScopedProject;
  cwd: string;
}) {
  void prepareUserTerminalWarmSlot(input);
}
