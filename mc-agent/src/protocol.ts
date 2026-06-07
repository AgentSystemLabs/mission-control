import type { AgentVersions } from "./health";

// ──────────────────────────────────────────────────────────────────────────
// Electron (client) → agent
// ──────────────────────────────────────────────────────────────────────────

export type SpawnMessage = {
  type: "spawn";
  /** Client-assigned id so output/exit replies correlate to the requesting PTY. */
  ptyId: string;
  taskId: string;
  cwd: string;
  command: string;
  /** Agent key (claude-code/codex/cursor-cli/opencode). Omit for a shell terminal. */
  agent?: string;
  shell?: boolean;
  /** Project-less "home" shell terminal: open at the agent's own home dir. */
  home?: boolean;
  args?: string[];
  cols?: number;
  rows?: number;
  dangerouslySkipPermissions?: boolean;
  missionControlTheme?: "dark" | "light";
  /** MC API the in-container hooks POST to; `port` is the MC port on the Docker host. */
  mcEnv?: { port?: number; token?: string };
};
export type WriteMessage = { type: "write"; ptyId: string; data: string };
export type ResizeMessage = { type: "resize"; ptyId: string; cols: number; rows: number };
export type KillMessage = { type: "kill"; ptyId: string };
export type ReplayMessage = { type: "replay"; ptyId: string };

/** Parameter shapes per RPC method. Keyed so each method maps to exactly one params type. */
export type RpcParams = {
  "fs.list": { path: string };
  "fs.read": { path: string };
  "fs.write": { path: string; content: string; expectedMtimeMs?: number | null };
  "fs.watch": { path: string };
  "fs.unwatch": { watchId: string };
  "git.status": { repo: string };
  "git.diff": { repo: string; file: string; staged?: boolean };
  "git.clone": { remote: string; slug: string; branch?: string };
  "ssh.setup":
    | { mode: "generate" }
    | { mode: "copy"; files: Array<{ name: string; content: string }> };
  "creds.setup": {
    items: Array<{ tool: CredsTool; kind: CredsKind; content: string }>;
  };
};

/** AI-CLI tools whose host login can be copied into a sandbox. */
export type CredsTool = "claude" | "codex" | "cursor" | "opencode";
/** Which file a credentials item maps to on the VM (the agent resolves the path). */
export type CredsKind = "credentials" | "state";
export type RpcMethod = keyof RpcParams;

export type RpcMessage = {
  [M in RpcMethod]: { type: "rpc"; reqId: string; method: M; params: RpcParams[M] };
}[RpcMethod];

export type ClientMessage =
  | SpawnMessage
  | WriteMessage
  | ResizeMessage
  | KillMessage
  | ReplayMessage
  | RpcMessage;

// ──────────────────────────────────────────────────────────────────────────
// agent → Electron (client)
// ──────────────────────────────────────────────────────────────────────────

export type ReadyMessage = {
  type: "ready";
  version: string;
  workspaceRoot: string;
  agents: AgentVersions;
};
export type SpawnedMessage = { type: "spawned"; ptyId: string };
export type SpawnErrorMessage = { type: "spawnError"; ptyId: string; code: string; message: string };
export type OutputMessage = { type: "output"; ptyId: string; seq: number; data: string };
export type ExitMessage = { type: "exit"; ptyId: string; exitCode?: number; signal?: number };
export type ReplayResultMessage = { type: "replayResult"; ptyId: string; data: string; nextSeq: number };
export type RpcResultMessage =
  | { type: "rpcResult"; reqId: string; ok: true; result: unknown }
  | { type: "rpcResult"; reqId: string; ok: false; error: string };
export type FsChangeMessage = { type: "fs.change"; watchId: string; path: string; mtimeMs: number };

export type ServerMessage =
  | ReadyMessage
  | SpawnedMessage
  | SpawnErrorMessage
  | OutputMessage
  | ExitMessage
  | ReplayResultMessage
  | RpcResultMessage
  | FsChangeMessage;

// ──────────────────────────────────────────────────────────────────────────
// Defensive wire parsing — the socket is paired but still untrusted input.
// ──────────────────────────────────────────────────────────────────────────

const RPC_METHODS: ReadonlySet<string> = new Set<RpcMethod>([
  "fs.list",
  "fs.read",
  "fs.write",
  "fs.watch",
  "fs.unwatch",
  "git.status",
  "git.diff",
  "git.clone",
  "ssh.setup",
  "creds.setup",
]);

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

/**
 * Parse and minimally validate an inbound WS frame into a ClientMessage.
 * Returns null for malformed frames so the server can ignore them rather than
 * throw. Field-level validation (path containment, arg allow-list) happens in
 * the handlers; this only guarantees the discriminant + required id shape.
 */
export function parseClientMessage(raw: string): ClientMessage | null {
  let msg: unknown;
  try {
    msg = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(msg) || typeof msg.type !== "string") return null;

  switch (msg.type) {
    case "spawn":
      if (typeof msg.ptyId !== "string" || typeof msg.cwd !== "string" || typeof msg.command !== "string") {
        return null;
      }
      return msg as unknown as SpawnMessage;
    case "write":
      if (typeof msg.ptyId !== "string" || typeof msg.data !== "string") return null;
      return msg as unknown as WriteMessage;
    case "resize":
      if (typeof msg.ptyId !== "string" || typeof msg.cols !== "number" || typeof msg.rows !== "number") {
        return null;
      }
      return msg as unknown as ResizeMessage;
    case "kill":
    case "replay":
      if (typeof msg.ptyId !== "string") return null;
      return msg as unknown as KillMessage | ReplayMessage;
    case "rpc":
      if (
        typeof msg.reqId !== "string" ||
        typeof msg.method !== "string" ||
        !RPC_METHODS.has(msg.method) ||
        !isRecord(msg.params)
      ) {
        return null;
      }
      return msg as unknown as RpcMessage;
    default:
      return null;
  }
}
