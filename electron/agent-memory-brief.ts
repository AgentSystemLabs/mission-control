import log from "electron-log/main";
import type { PtyHookEnv } from "./pty-hook-env";
import { supportsMemoryInjection, writeAgentMemoryFile } from "../src/shared/agent-memory-file";

// Fetch the rendered Session Brief from the local API server (which owns the DB)
// and write it into the agent's auto-load file BEFORE the PTY spawns, so the
// agent reads current project memory on startup. Fail-soft in every branch —
// injecting a brief must never delay or block a session from starting.

const BRIEF_FETCH_TIMEOUT_MS = 1500;

export async function installAgentMemoryBrief(params: {
  agent: string | undefined;
  cwd: string;
  taskId: string;
  mcEnv: PtyHookEnv | null;
}): Promise<void> {
  const { agent, cwd, taskId, mcEnv } = params;
  if (!supportsMemoryInjection(agent) || !mcEnv?.apiUrl || !mcEnv?.token || !taskId) return;

  let brief = "";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), BRIEF_FETCH_TIMEOUT_MS);
  try {
    const url = `${mcEnv.apiUrl}/api/tasks/${encodeURIComponent(taskId)}/brief`;
    const res = await fetch(url, {
      headers: {
        authorization: `Bearer ${mcEnv.token}`,
        "X-Mission-Control-Runtime": "electron-local",
      },
      signal: controller.signal,
    });
    if (!res.ok) return;
    const data = (await res.json()) as { brief?: string };
    brief = typeof data.brief === "string" ? data.brief : "";
  } catch {
    // Timeout / server unreachable / bad JSON — skip injection, keep any
    // previously-written brief on disk, and let the session start normally.
    log.warn("recall.brief.fetch_failed", { taskId, agent: agent ?? null });
    return;
  } finally {
    clearTimeout(timer);
  }

  try {
    // Empty brief (no memories / Recall off) strips any stale managed block.
    writeAgentMemoryFile(agent, cwd, brief);
  } catch {
    /* writer is already fail-soft */
  }
}
