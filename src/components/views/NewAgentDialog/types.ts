import { AGENT_REGISTRY, UI_AGENTS } from "~/shared/agents";
import type { TaskAgent } from "~/shared/domain";

export type RememberPatch = {
  rememberAgentSettings: boolean;
  savedAgent: TaskAgent | null;
  savedSkipPermissions: boolean;
  savedBareSession: boolean;
};

export type MissingCli = {
  cmd: string;
  label: string;
};

export const AGENT_OPTIONS = UI_AGENTS.map((id) => ({ id, ...AGENT_REGISTRY[id] }));
