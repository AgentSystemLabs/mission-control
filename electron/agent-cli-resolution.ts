import * as os from "node:os";
import { pathLookupCandidates } from "../src/shared/agent-cli-config";
import { resolveCommandOnPath } from "./shell-env";

export function resolveAgentCommandOnPath(
  command: string,
  env?: NodeJS.ProcessEnv,
  platform: NodeJS.Platform = os.platform(),
): string | null {
  for (const candidate of pathLookupCandidates(command)) {
    const resolved = resolveCommandOnPath(candidate, env, platform);
    if (resolved) return resolved;
  }
  return null;
}
