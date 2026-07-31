import type { TaskAgent } from "./domain";

/** Wire type for GET /api/agent-launchers/accounts. Display identifier only — never a token. */
export type AgentAccountStatus = {
  agent: TaskAgent;
  connected: boolean;
  identifier: string | null;
};

/** Wire type for GET /api/agent-launchers/latest-versions. */
export type AgentLatestVersion = {
  agent: TaskAgent;
  /** False when the CLI has no native or registry-backed latest-version source. */
  supported: boolean;
  latestVersion: string | null;
  checkedAt: string;
  error?: string;
};
