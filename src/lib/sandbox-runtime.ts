import { getElectron, type ElectronBridge } from "~/lib/electron";
import type { SandboxRuntimeMode } from "~/shared/electron-contract";

let cachedRuntimeMode: SandboxRuntimeMode | null = null;

export function cachedSandboxRuntimeMode(): SandboxRuntimeMode | null {
  return cachedRuntimeMode;
}

export async function readSandboxRuntimeMode(
  electron: ElectronBridge | null = getElectron(),
): Promise<SandboxRuntimeMode> {
  if (!electron?.sandbox) {
    cachedRuntimeMode = "host";
    return "host";
  }

  try {
    // Phase 2: runtime follows the active scope. The manager returns a non-disabled
    // state for getState() (no arg) exactly when a sandbox scope is active; Local
    // (or no selection) yields `disabled` → host PTY.
    const state = await electron.sandbox.getState();
    const mode: SandboxRuntimeMode = state.status === "disabled" ? "host" : "docker";
    cachedRuntimeMode = mode;
    return mode;
  } catch {
    cachedRuntimeMode = "host";
    return "host";
  }
}

export async function isDockerSandboxRuntime(
  electron: ElectronBridge | null = getElectron(),
): Promise<boolean> {
  return (await readSandboxRuntimeMode(electron)) === "docker";
}
