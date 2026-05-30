import { execFile } from "node:child_process";
import { AGENT_CLI_CONFIG } from "../../src/shared/agent-cli-config";
import { resolveAgentCommandOnPath } from "./command-resolver";

/** Map of agent command -> first line of its `--version`, or null if absent. */
export type AgentVersions = Record<string, string | null>;

const VERSION_TIMEOUT_MS = 5_000;

function probeVersion(bin: string): Promise<string | null> {
  return new Promise((resolve) => {
    const child = execFile(
      bin,
      ["--version"],
      { timeout: VERSION_TIMEOUT_MS, windowsHide: true },
      (err, stdout) => {
        if (err) return resolve(null);
        const firstLine = stdout.toString().trim().split("\n")[0] ?? "";
        resolve(firstLine || null);
      },
    );
    child.on("error", () => resolve(null));
  });
}

/** Probe every managed agent CLI's version, in parallel. Missing CLIs report null. */
export async function probeAgentVersions(
  env: NodeJS.ProcessEnv = process.env,
): Promise<AgentVersions> {
  const out: AgentVersions = {};
  await Promise.all(
    Object.values(AGENT_CLI_CONFIG).map(async (cfg) => {
      const bin = resolveAgentCommandOnPath(cfg.command, env);
      out[cfg.command] = bin ? await probeVersion(bin) : null;
    }),
  );
  return out;
}
