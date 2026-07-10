/**
 * Local "who is signed in" detection for the managed agent CLIs. Reads only
 * the auth files each CLI already writes; the returned identifier is a
 * display value (email / account id / user id) — tokens never leave here.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { TaskAgent } from "~/shared/domain";
import { MANAGED_AGENTS } from "~/shared/agent-cli-config";
import type { AgentAccountStatus } from "~/shared/agent-launchers";
import { readCodexOAuthCredentials } from "./provider-usage/codex-usage";
import { readCursorUserId } from "./provider-usage/cursor-usage";

export type { AgentAccountStatus } from "~/shared/agent-launchers";

let homeDir: () => string = os.homedir;
let codexReader: () => { accountId: string | null } | null = readCodexOAuthCredentials;
let cursorReader: () => string | null = readCursorUserId;

function readClaudeAccount(): AgentAccountStatus {
  // ~/.claude.json also holds per-project caches and can be several MB, so no
  // size cap here — just tolerate parse failures.
  try {
    const raw = fs.readFileSync(path.join(homeDir(), ".claude.json"), "utf8");
    const json = JSON.parse(raw) as Record<string, unknown>;
    const account =
      json.oauthAccount && typeof json.oauthAccount === "object"
        ? (json.oauthAccount as Record<string, unknown>)
        : null;
    if (!account) return { agent: "claude-code", connected: false, identifier: null };
    const email =
      typeof account.emailAddress === "string" && account.emailAddress.trim()
        ? account.emailAddress.trim()
        : null;
    return { agent: "claude-code", connected: true, identifier: email };
  } catch {
    return { agent: "claude-code", connected: false, identifier: null };
  }
}

function readCodexAccount(): AgentAccountStatus {
  try {
    const creds = codexReader();
    if (!creds) return { agent: "codex", connected: false, identifier: null };
    return { agent: "codex", connected: true, identifier: creds.accountId };
  } catch {
    return { agent: "codex", connected: false, identifier: null };
  }
}

function readCursorAccount(): AgentAccountStatus {
  try {
    const userId = cursorReader();
    return { agent: "cursor-cli", connected: userId !== null, identifier: userId };
  } catch {
    return { agent: "cursor-cli", connected: false, identifier: null };
  }
}

function readOpenCodeAccount(): AgentAccountStatus {
  try {
    const dataHome = process.env.XDG_DATA_HOME?.trim() || path.join(homeDir(), ".local", "share");
    const connected = fs.existsSync(path.join(dataHome, "opencode", "auth.json"));
    return { agent: "opencode", connected, identifier: null };
  } catch {
    return { agent: "opencode", connected: false, identifier: null };
  }
}

export function readAgentAccounts(): AgentAccountStatus[] {
  const byAgent: Record<TaskAgent, () => AgentAccountStatus> = {
    "claude-code": readClaudeAccount,
    codex: readCodexAccount,
    "cursor-cli": readCursorAccount,
    opencode: readOpenCodeAccount,
  };
  return MANAGED_AGENTS.map((agent) => byAgent[agent]());
}

export function _setAgentAccountsDepsForTests(deps: {
  homeDir?: (() => string) | null;
  codexReader?: (() => { accountId: string | null } | null) | null;
  cursorReader?: (() => string | null) | null;
}): void {
  if (deps.homeDir !== undefined) homeDir = deps.homeDir ?? os.homedir;
  if (deps.codexReader !== undefined) codexReader = deps.codexReader ?? readCodexOAuthCredentials;
  if (deps.cursorReader !== undefined) cursorReader = deps.cursorReader ?? readCursorUserId;
}
