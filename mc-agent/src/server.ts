import { createServer, type IncomingMessage, type Server } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { WebSocketServer, type WebSocket, type RawData } from "ws";
import { PtyHost } from "./pty-host";
import { FileRpc } from "./file-rpc";
import { GitRpc } from "./git-rpc";
import { SshRpc } from "./ssh-rpc";
import { probeAgentVersions } from "./health";
import { parseClientMessage, type ServerMessage, type RpcMessage } from "./protocol";
import type { AgentConfig } from "./config";
import { log } from "./logger";
import { AGENT_VERSION } from "./version";

export { AGENT_VERSION } from "./version";

let connSeq = 0;
const authFailures = new Map<string, { count: number; resetAt: number }>();
const AUTH_FAILURE_WINDOW_MS = 60_000;
const AUTH_FAILURE_LIMIT = 20;

function constantTimeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

function authFailureKey(req: IncomingMessage): string {
  return req.socket.remoteAddress || "unknown";
}

function isRateLimited(req: IncomingMessage): boolean {
  const key = authFailureKey(req);
  const now = Date.now();
  const current = authFailures.get(key);
  if (!current || current.resetAt <= now) return false;
  return current.count >= AUTH_FAILURE_LIMIT;
}

function recordAuthFailure(req: IncomingMessage): void {
  const key = authFailureKey(req);
  const now = Date.now();
  const current = authFailures.get(key);
  if (!current || current.resetAt <= now) {
    authFailures.set(key, { count: 1, resetAt: now + AUTH_FAILURE_WINDOW_MS });
    return;
  }
  current.count += 1;
}

function clearAuthFailures(req: IncomingMessage): void {
  authFailures.delete(authFailureKey(req));
}

/** Pull the pairing token from the `Authorization: Bearer` header only. */
function extractToken(req: IncomingMessage): string {
  const auth = req.headers["authorization"];
  if (typeof auth === "string" && auth.startsWith("Bearer ")) {
    return auth.slice("Bearer ".length);
  }
  return "";
}

export function isPaired(req: IncomingMessage, config: AgentConfig): boolean {
  if (config.pairingToken === "") return true; // only reachable in MC_AGENT_INSECURE mode
  return constantTimeEqual(extractToken(req), config.pairingToken);
}

function handleConnection(ws: WebSocket, config: AgentConfig): void {
  const connId = `c${++connSeq}`;
  const emit = (msg: ServerMessage): void => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
  };

  const ptyHost = new PtyHost(emit, { workspaceRoot: config.workspaceRoot, connId });
  const fileRpc = new FileRpc(config.workspaceRoot, emit);
  const gitRpc = new GitRpc(config.workspaceRoot);
  const sshRpc = new SshRpc();
  log("info", "ws.open", { connId });

  const dispatchRpc = async (msg: RpcMessage): Promise<void> => {
    try {
      let result: unknown;
      switch (msg.method) {
        case "fs.list":
          result = fileRpc.list(msg.params);
          break;
        case "fs.read":
          result = fileRpc.read(msg.params);
          break;
        case "fs.write":
          result = fileRpc.write(msg.params);
          break;
        case "fs.watch":
          result = fileRpc.watch(msg.params);
          break;
        case "fs.unwatch":
          result = fileRpc.unwatch(msg.params);
          break;
        case "git.status":
          result = await gitRpc.status(msg.params);
          break;
        case "git.diff":
          result = await gitRpc.diff(msg.params);
          break;
        case "git.clone":
          result = await gitRpc.clone(msg.params);
          break;
        case "ssh.setup":
          result = await sshRpc.setup(msg.params);
          break;
      }
      emit({ type: "rpcResult", reqId: msg.reqId, ok: true, result });
    } catch (err) {
      // Preserve the original error server-side (the wire only carries .message).
      log("error", "rpc.fail", {
        connId,
        method: msg.method,
        reqId: msg.reqId,
        err: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
      emit({
        type: "rpcResult",
        reqId: msg.reqId,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  };

  ws.on("message", (raw: RawData) => {
    const msg = parseClientMessage(raw.toString());
    if (!msg) return;
    switch (msg.type) {
      case "spawn":
        ptyHost.spawn(msg);
        break;
      case "write":
        ptyHost.write(msg.ptyId, msg.data);
        break;
      case "resize":
        ptyHost.resize(msg.ptyId, msg.cols, msg.rows);
        break;
      case "kill":
        ptyHost.kill(msg.ptyId);
        break;
      case "replay":
        ptyHost.replay(msg.ptyId);
        break;
      case "rpc":
        void dispatchRpc(msg);
        break;
    }
  });

  let cleanedUp = false;
  const cleanup = (): void => {
    if (cleanedUp) return;
    cleanedUp = true;
    ptyHost.killAll();
    fileRpc.closeAll();
    log("info", "ws.close", { connId });
  };
  ws.on("close", cleanup);
  ws.on("error", (err) => {
    log("warn", "ws.error", { connId, err: err instanceof Error ? err.message : String(err) });
    cleanup();
  });

  // Announce readiness with the probed agent CLI versions. A probe failure must
  // not become an unhandled rejection (it would take down every connection).
  probeAgentVersions()
    .then((agents) => {
      emit({ type: "ready", version: AGENT_VERSION, workspaceRoot: config.workspaceRoot, agents });
    })
    .catch((err) => {
      log("error", "ready.probe.fail", { connId, err: err instanceof Error ? err.message : String(err) });
      emit({ type: "ready", version: AGENT_VERSION, workspaceRoot: config.workspaceRoot, agents: {} });
    });
}

/**
 * Create the mc-agent HTTP+WS server. GET /health returns liveness JSON; the WS
 * endpoint requires the pairing token and drives PTYs + file/git RPC.
 */
export function createAgentServer(config: AgentConfig): Server {
  const httpServer = createServer((req, res) => {
    if (req.method === "GET" && (req.url ?? "").split("?")[0] === "/health") {
      // Unauthenticated liveness probe — keep it to ok/version only. The workspace
      // root is environment detail that the token-gated `ready` payload carries instead.
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, version: AGENT_VERSION }));
      return;
    }
    res.writeHead(404);
    res.end();
  });

  const wss = new WebSocketServer({ noServer: true });

  httpServer.on("upgrade", (req, socket, head) => {
    if (isRateLimited(req)) {
      log("warn", "ws.reject", { reason: "rate-limited", remote: req.socket.remoteAddress });
      socket.write("HTTP/1.1 429 Too Many Requests\r\n\r\n");
      socket.destroy();
      return;
    }
    if (!isPaired(req, config)) {
      // Never log req.url — the token may ride in the query string.
      recordAuthFailure(req);
      log("warn", "ws.reject", { reason: "bad-token", remote: req.socket.remoteAddress });
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }
    clearAuthFailures(req);
    wss.handleUpgrade(req, socket, head, (ws) => {
      handleConnection(ws, config);
    });
  });

  return httpServer;
}
