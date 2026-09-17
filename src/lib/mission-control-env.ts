import type { ElectronBridge } from "~/shared/electron-contract";
import { resolveApiToken } from "~/lib/api";

export type MissionControlEnv = { apiUrl: string; token: string };

/**
 * The `MC_API_URL` / `MC_API_TOKEN` pair handed to an agent PTY so its hooks and
 * skills can call back into this Mission Control instance. `undefined` when
 * either half is unavailable (server not up yet, token not primed) — callers
 * spawn without it rather than block.
 */
export async function resolveMcEnv(
  electron: ElectronBridge,
): Promise<MissionControlEnv | undefined> {
  try {
    const [port, token] = await Promise.all([electron.getRuntimePort(), resolveApiToken()]);
    if (!port || !token) return undefined;
    return { apiUrl: `http://127.0.0.1:${port}`, token };
  } catch {
    return undefined;
  }
}
