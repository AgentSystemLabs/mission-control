// Reusable request/subscription layer over the remote sandbox agent WebSocket.
//
// The sandbox manager owns ONE of these per live connection. It turns the raw
// agent protocol into: (a) promise-based RPC (reqId ⇄ rpcResult correlation)
// for fs.* / git.* and (b) fire-and-forget PTY control with callback streams for
// output/exit. The remotePty / remoteFs / remoteGit IPC bridges call into this.
//
// Message shapes mirror the published @agentsystemlabs/mission-control-agent
// protocol structurally (kept inline so the Electron build doesn't import the
// agent package's runtime deps — same convention as the preload bridge types).

import log from "electron-log/main";

export interface WebSocketLike {
  readonly readyState: number;
  send(data: string): void;
  close(): void;
  on(event: "open", cb: () => void): void;
  on(event: "message", cb: (data: unknown) => void): void;
  on(event: "close", cb: () => void): void;
  on(event: "error", cb: (err: Error) => void): void;
  removeAllListeners(): void;
}

export type AgentVersions = Record<string, string | null>;

export type AgentClientHandlers = {
  onReady?: (version: string, agents: AgentVersions) => void;
  onSpawned?: (ptyId: string) => void;
  onSpawnError?: (ptyId: string, code: string, message: string) => void;
  onOutput?: (ptyId: string, seq: number, data: string) => void;
  onExit?: (ptyId: string, exitCode: number | undefined, signal: number | undefined) => void;
  onReplayResult?: (ptyId: string, data: string, nextSeq: number) => void;
  onFsChange?: (watchId: string, path: string, mtimeMs: number) => void;
  onHook?: (slug: string, taskId: string, hookEvent: string | undefined, body: string) => void;
  onClose?: () => void;
  onError?: (err: Error) => void;
};

export type SpawnArgs = {
  ptyId: string;
  taskId: string;
  cwd: string;
  command: string;
  agent?: string;
  shell?: boolean;
  /** Project-less "home" shell terminal: open at the remote agent's home dir. */
  home?: boolean;
  args?: string[];
  cols?: number;
  rows?: number;
  dangerouslySkipPermissions?: boolean;
  missionControlTheme?: "dark" | "light";
  mcEnv?: { port?: number; token?: string };
};

export type RpcMethod =
  | "fs.list"
  | "fs.read"
  | "fs.write"
  | "fs.watch"
  | "fs.unwatch"
  | "git.status"
  | "git.diff"
  | "git.clone"
  | "ssh.setup"
  | "creds.setup";

const DEFAULT_RPC_TIMEOUT_MS = 30_000;

type Pending = {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  method: RpcMethod;
};

export type CreateSocket = (url: string, token: string, opts?: { ca?: string }) => WebSocketLike;

export type SandboxAgentClientOptions = {
  /** Injectable socket factory (tests). Default: a real `ws` WebSocket with Bearer auth. */
  createSocket?: CreateSocket;
  rpcTimeoutMs?: number;
  /** PEM of a self-signed cert to pin for `wss://` connections (managed cloud VMs). */
  tlsCa?: string | null;
};

export class SandboxAgentClient {
  private readonly socket: WebSocketLike;
  private readonly handlers: AgentClientHandlers;
  private readonly pending = new Map<string, Pending>();
  private readonly rpcTimeoutMs: number;
  private reqSeq = 0;
  private closed = false;

  constructor(
    url: string,
    token: string,
    handlers: AgentClientHandlers,
    opts: SandboxAgentClientOptions = {},
  ) {
    this.handlers = handlers;
    this.rpcTimeoutMs = opts.rpcTimeoutMs ?? DEFAULT_RPC_TIMEOUT_MS;
    const create = opts.createSocket ?? defaultCreateSocket;
    this.socket = create(url, token, opts.tlsCa ? { ca: opts.tlsCa } : undefined);
    this.socket.on("message", (data) => this.onMessage(data));
    this.socket.on("close", () => this.onCloseEvent());
    this.socket.on("error", (err) => this.handlers.onError?.(err));
  }

  get isOpen(): boolean {
    return !this.closed && this.socket.readyState === OPEN_STATE;
  }

  /** Promise-based RPC for fs.* / git.* — correlates reqId ⇄ rpcResult. */
  rpc(method: RpcMethod, params: Record<string, unknown>, opts: { timeoutMs?: number } = {}): Promise<unknown> {
    if (this.closed) return Promise.reject(new Error("agent connection closed"));
    if (this.socket.readyState !== OPEN_STATE) {
      return Promise.reject(new Error("agent connection is not open"));
    }
    const reqId = `r${++this.reqSeq}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(reqId);
        reject(new Error(`agent rpc ${method} timed out`));
      }, opts.timeoutMs ?? this.rpcTimeoutMs);
      this.pending.set(reqId, { resolve, reject, timer, method });
      if (method === "creds.setup") {
        const items = Array.isArray(params.items) ? params.items : [];
        log.info("sandbox.agent-creds.rpc.transport.send", {
          event: "sandbox.agent-creds.rpc.transport.send",
          reqId,
          method,
          itemCount: items.length,
          items: items.map((item) => {
            const row = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
            const content = typeof row.content === "string" ? row.content : "";
            return {
              tool: row.tool,
              kind: row.kind,
              bytes: content ? Buffer.byteLength(content, "utf8") : 0,
            };
          }),
        });
      }
      this.trySend({ type: "rpc", reqId, method, params });
    });
  }

  spawn(args: SpawnArgs): void {
    this.trySend({ type: "spawn", ...args });
  }
  write(ptyId: string, data: string): void {
    this.trySend({ type: "write", ptyId, data });
  }
  resize(ptyId: string, cols: number, rows: number): void {
    this.trySend({ type: "resize", ptyId, cols, rows });
  }
  kill(ptyId: string): void {
    this.trySend({ type: "kill", ptyId });
  }
  replay(ptyId: string): void {
    this.trySend({ type: "replay", ptyId });
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.rejectAllPending(new Error("agent connection closed"));
    try {
      // Keep our error listener installed while closing. `ws.close()` can emit
      // "WebSocket was closed before the connection was established" for a
      // CONNECTING socket; removing listeners first turns that into an uncaught
      // exception during app shutdown.
      this.socket.close();
    } catch {
      /* best effort */
    }
  }

  private trySend(msg: unknown): void {
    if (this.closed) return;
    try {
      this.socket.send(JSON.stringify(msg));
    } catch (err) {
      this.handlers.onError?.(err instanceof Error ? err : new Error(String(err)));
    }
  }

  private onCloseEvent(): void {
    if (this.closed) return;
    this.closed = true;
    this.rejectAllPending(new Error("agent connection closed"));
    this.handlers.onClose?.();
  }

  private rejectAllPending(err: Error): void {
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(err);
    }
    this.pending.clear();
  }

  private onMessage(data: unknown): void {
    if (this.closed) return;
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(typeof data === "string" ? data : String(data));
    } catch {
      return;
    }
    if (!msg || typeof msg.type !== "string") return;

    switch (msg.type) {
      case "ready":
        this.handlers.onReady?.(
          typeof msg.version === "string" ? msg.version : "?",
          (msg.agents as AgentVersions) ?? {},
        );
        return;
      case "spawned":
        if (typeof msg.ptyId === "string") this.handlers.onSpawned?.(msg.ptyId);
        return;
      case "spawnError":
        if (typeof msg.ptyId === "string") {
          this.handlers.onSpawnError?.(
            msg.ptyId,
            typeof msg.code === "string" ? msg.code : "spawn-failed",
            typeof msg.message === "string" ? msg.message : "",
          );
        }
        return;
      case "output":
        if (typeof msg.ptyId === "string" && typeof msg.seq === "number") {
          this.handlers.onOutput?.(msg.ptyId, msg.seq, typeof msg.data === "string" ? msg.data : "");
        }
        return;
      case "exit":
        if (typeof msg.ptyId === "string") {
          this.handlers.onExit?.(
            msg.ptyId,
            typeof msg.exitCode === "number" ? msg.exitCode : undefined,
            typeof msg.signal === "number" ? msg.signal : undefined,
          );
        }
        return;
      case "replayResult":
        if (typeof msg.ptyId === "string") {
          this.handlers.onReplayResult?.(
            msg.ptyId,
            typeof msg.data === "string" ? msg.data : "",
            typeof msg.nextSeq === "number" ? msg.nextSeq : 0,
          );
        }
        return;
      case "fs.change":
        if (typeof msg.watchId === "string") {
          this.handlers.onFsChange?.(
            msg.watchId,
            typeof msg.path === "string" ? msg.path : "",
            typeof msg.mtimeMs === "number" ? msg.mtimeMs : 0,
          );
        }
        return;
      case "hook":
        if (typeof msg.slug === "string" && typeof msg.taskId === "string") {
          this.handlers.onHook?.(
            msg.slug,
            msg.taskId,
            typeof msg.hookEvent === "string" ? msg.hookEvent : undefined,
            typeof msg.body === "string" ? msg.body : "",
          );
        }
        return;
      case "rpcResult": {
        const reqId = typeof msg.reqId === "string" ? msg.reqId : null;
        if (!reqId) return;
        const pending = this.pending.get(reqId);
        if (!pending) return;
        this.pending.delete(reqId);
        clearTimeout(pending.timer);
        if (pending.method === "creds.setup") {
          const result =
            msg.ok === true && msg.result && typeof msg.result === "object"
              ? (msg.result as Record<string, unknown>)
              : null;
          log.info("sandbox.agent-creds.rpc.transport.recv", {
            event: "sandbox.agent-creds.rpc.transport.recv",
            reqId,
            method: pending.method,
            ok: msg.ok === true,
            error: msg.ok === true ? null : typeof msg.error === "string" ? msg.error : "rpc failed",
            wrote: typeof result?.wrote === "number" ? result.wrote : null,
            written: Array.isArray(result?.written) ? result.written : null,
          });
        }
        if (msg.ok === true) pending.resolve(msg.result);
        else pending.reject(new Error(typeof msg.error === "string" ? msg.error : "rpc failed"));
        return;
      }
      default:
        return;
    }
  }
}

const OPEN_STATE = 1; // ws.OPEN

function defaultCreateSocket(url: string, token: string, opts?: { ca?: string }): WebSocketLike {
  // Lazy require so this module stays importable in tests without `ws` semantics.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { WebSocket } = require("ws") as typeof import("ws");
  const wsOptions: Record<string, unknown> = { headers: { Authorization: `Bearer ${token}` } };
  if (opts?.ca) {
    // Managed cloud VMs terminate TLS with a self-signed cert. Pin it by value:
    // trust exactly this cert (as its own CA) and skip the hostname check, since
    // the cert is issued for an opaque CN rather than the raw IP we dial.
    wsOptions.ca = [opts.ca];
    wsOptions.checkServerIdentity = () => undefined;
  }
  return new WebSocket(url, wsOptions) as unknown as WebSocketLike;
}
