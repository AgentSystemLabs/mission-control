import path from "node:path";
import { randomBytes } from "node:crypto";
import { serverEnv } from "~/shared/env";
import { getProjectRow, updateProject } from "../services/projects";
import type { TaskAgent } from "~/shared/domain";
import { logger } from "~/shared/logger";

type DaytonaClient = {
  create(opts?: Record<string, unknown>): Promise<DaytonaSandbox>;
  get?(id: string): Promise<DaytonaSandbox>;
  list?(): Promise<DaytonaSandbox[] | { items?: DaytonaSandbox[]; sandboxes?: DaytonaSandbox[] }>;
  start?(sandbox: DaytonaSandbox, timeout?: number): Promise<void>;
};

type DaytonaSandbox = {
  id?: string;
  sandboxId?: string;
  state?: string;
  recoverable?: boolean;
  getSignedPreviewUrl?(port: number, expiresInSeconds?: number): Promise<{ url: string }>;
  start?(timeout?: number): Promise<void>;
  recover?(timeout?: number): Promise<void>;
  refreshData?(): Promise<void>;
  process: {
    executeCommand?(
      command: string,
      cwd?: string,
      env?: Record<string, string>,
      timeout?: number,
    ): Promise<{ exitCode?: number; result?: string; artifacts?: { stdout?: string } }>;
    createPty(opts: {
      id: string;
      cwd?: string;
      envs?: Record<string, string>;
      cols?: number;
      rows?: number;
      onData?: (data: Uint8Array) => void;
    }): Promise<DaytonaPtyHandle>;
    connectPty?(id: string, opts?: { onData?: (data: Uint8Array) => void }): Promise<DaytonaPtyHandle>;
    resizePtySession?(id: string, cols: number, rows: number): Promise<unknown>;
  };
  fs: {
    listFiles(path: string): Promise<Array<{ name: string; isDir?: boolean; size?: number; modTime?: string | number }>>;
    downloadFile(path: string): Promise<Buffer | Uint8Array>;
    uploadFile(data: Buffer | Uint8Array, path: string): Promise<unknown>;
    deleteFile?(path: string, recursive?: boolean): Promise<unknown>;
  };
  git?: {
    clone(url: string, path: string): Promise<unknown>;
    status(path: string): Promise<{ currentBranch?: string }>;
  };
};

type DaytonaPtyHandle = {
  waitForConnection?: () => Promise<void>;
  sendInput: (data: string) => Promise<unknown>;
  resize?: (cols: number, rows: number) => Promise<unknown>;
  wait?: () => Promise<{ exitCode?: number; signal?: number }>;
  disconnect?: () => Promise<unknown>;
};

export type RuntimePtySpawn = {
  taskId: string;
  projectId: string;
  subPath?: string;
  command: string;
  args?: string[];
  cols?: number;
  rows?: number;
  agent?: TaskAgent | string;
  mcEnv?: { apiUrl?: string; token?: string };
};

export type RuntimeEvent =
  | { type: "pty:data"; projectId: string; ptyId: string; data: string }
  | { type: "pty:exit"; projectId: string; ptyId: string; exitCode: number; signal?: number }
  | { type: "files:changed"; projectId: string; watchId: string; mtimeMs: number };

const importDaytonaSdk = new Function("return import('@daytona/sdk')") as () => Promise<{ Daytona: new (opts?: { apiKey?: string }) => DaytonaClient }>;

let daytonaClient: DaytonaClient | null = null;
const textDecoder = new TextDecoder();
const RING_LIMIT_BYTES = 1_000_000;
const MAX_LISTED_FILES = 50_000;
const MAX_READ_BYTES = 5 * 1024 * 1024;
const MAX_WRITE_BYTES = MAX_READ_BYTES;
const MAX_READ_LINES = 1000;

type PtyState = {
  id: string;
  taskId: string;
  projectId: string;
  command: string;
  sandbox: DaytonaSandbox;
  handle: DaytonaPtyHandle;
  buffer: string[];
  bufferBytes: number;
};

const ptys = new Map<string, PtyState>();
const watchers = new Set<string>();
const eventSubscribers = new Set<(event: RuntimeEvent) => void>();
const sandboxInflight = new Map<string, Promise<DaytonaSandbox>>();
const fileWriteLocks = new Map<string, Promise<unknown>>();
const ptyConnectInflight = new Map<string, Promise<PtyState | null>>();
const ptyWriteQueues = new Map<string, Promise<unknown>>();
const DEFAULT_WORKSPACE_ROOT = "workspace";
const LEGACY_ABSOLUTE_WORKSPACE_ROOT = "/workspace";
const PTY_SERVER_PORT = 44777;
const PTY_SERVER_PROCESS_NAME = "mission-control-websocket-pty-server";
const PTY_SERVER_CODE_PATH = "/tmp/mission-control-websocket-pty-server-v2.js";

function runtimePtyId(projectId: string): string {
  const encodedProjectId = Buffer.from(projectId, "utf8").toString("hex");
  return `cloud-pty-${encodedProjectId}-${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`;
}

function projectIdFromRuntimePtyId(ptyId: string): string | null {
  const match = /^cloud-pty-([0-9a-f]+)-[a-z0-9]+-[0-9a-f]+$/.exec(ptyId);
  if (!match) return null;
  try {
    const projectId = Buffer.from(match[1]!, "hex").toString("utf8");
    return projectId || null;
  } catch {
    return null;
  }
}

function emit(event: RuntimeEvent) {
  for (const subscriber of eventSubscribers) subscriber(event);
}

export function subscribeRuntimeEvents(cb: (event: RuntimeEvent) => void): () => void {
  eventSubscribers.add(cb);
  return () => eventSubscribers.delete(cb);
}

function appendBuffer(p: PtyState, chunk: string) {
  p.buffer.push(chunk);
  p.bufferBytes += Buffer.byteLength(chunk, "utf8");
  while (p.bufferBytes > RING_LIMIT_BYTES && p.buffer.length > 1) {
    const dropped = p.buffer.shift()!;
    p.bufferBytes -= Buffer.byteLength(dropped, "utf8");
  }
}

async function getDaytona(): Promise<DaytonaClient> {
  if (daytonaClient) return daytonaClient;
  const apiKey = serverEnv().DAYTONA_API_KEY;
  if (!apiKey) throw new Error("DAYTONA_API_KEY is required for the cloud runtime");
  const { Daytona } = await importDaytonaSdk();
  daytonaClient = new Daytona({ apiKey });
  return daytonaClient;
}

function sandboxId(sandbox: DaytonaSandbox): string | null {
  return sandbox.id ?? sandbox.sandboxId ?? null;
}

async function findSandbox(id: string): Promise<DaytonaSandbox | null> {
  const daytona = await getDaytona();
  if (daytona.get) {
    try {
      return await daytona.get(id);
    } catch (err: unknown) {
      if (!isNotFoundError(err)) throw err;
    }
  }
  if (!daytona.list) throw new Error("Daytona client does not expose sandbox lookup");
  const sandboxes = daytonaListItems(await daytona.list());
  return sandboxes.find((s) => sandboxId(s) === id) ?? null;
}

function daytonaListItems(
  response: DaytonaSandbox[] | { items?: DaytonaSandbox[]; sandboxes?: DaytonaSandbox[] },
): DaytonaSandbox[] {
  if (Array.isArray(response)) return response;
  if (Array.isArray(response.items)) return response.items;
  if (Array.isArray(response.sandboxes)) return response.sandboxes;
  throw new Error("Daytona sandbox list returned an unexpected response");
}

function isNotFoundError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { name?: unknown; statusCode?: unknown };
  return e.name === "DaytonaNotFoundError" || e.statusCode === 404;
}

export function __setDaytonaClientForTests(client: DaytonaClient | null): void {
  daytonaClient = client;
}

function defaultWorkspacePath(): string {
  return serverEnv().DAYTONA_WORKSPACE_PATH ?? DEFAULT_WORKSPACE_ROOT;
}

function normalizeWorkspacePath(value?: string | null): string {
  const workspacePath = value || defaultWorkspacePath();
  if (workspacePath === LEGACY_ABSOLUTE_WORKSPACE_ROOT) return DEFAULT_WORKSPACE_ROOT;
  if (workspacePath.startsWith(`${LEGACY_ABSOLUTE_WORKSPACE_ROOT}/`)) {
    return `${DEFAULT_WORKSPACE_ROOT}${workspacePath.slice(LEGACY_ABSOLUTE_WORKSPACE_ROOT.length)}`;
  }
  return workspacePath;
}

function projectWorkspacePath(project: NonNullable<Awaited<ReturnType<typeof getProjectRow>>>): string {
  return normalizeWorkspacePath(project.workspacePath || project.path);
}

async function resolveWorkspacePath(projectId: string, subPath?: string): Promise<string> {
  const row = await getProjectRow(projectId);
  const root = row ? projectWorkspacePath(row) : defaultWorkspacePath();
  if (!subPath) return root;
  const normalized = normalizeRelativePath(subPath);
  if (!normalized) throw new Error("invalid-path");
  return path.posix.join(root, normalized);
}

export async function getRuntimeWorkspacePath(projectId: string): Promise<string> {
  return resolveWorkspacePath(projectId);
}

function normalizeRelativePath(relPath: string): string | null {
  if (!relPath || relPath.includes("\0") || path.posix.isAbsolute(relPath)) return null;
  const normalized = path.posix.normalize(relPath);
  if (normalized === "." || normalized.startsWith("../") || normalized === "..") return null;
  return normalized;
}

export async function ensureProjectSandbox(projectId: string): Promise<DaytonaSandbox> {
  const existing = sandboxInflight.get(projectId);
  if (existing) return existing;
  const next = ensureProjectSandboxInner(projectId).finally(() => {
    if (sandboxInflight.get(projectId) === next) sandboxInflight.delete(projectId);
  });
  sandboxInflight.set(projectId, next);
  return next;
}

async function ensureProjectSandboxInner(projectId: string): Promise<DaytonaSandbox> {
  const project = await getProjectRow(projectId);
  if (!project) throw new Error("unknown project");
  if (project.sandboxId) {
    const existing = await findSandbox(project.sandboxId);
    if (existing) {
      await ensureSandboxReady(existing, project.id);
      await ensureProjectRepository(existing, project);
      return existing;
    }
  }

  const daytona = await getDaytona();
  const fresh = await getProjectRow(projectId);
  if (fresh?.sandboxId) {
    const existing = await findSandbox(fresh.sandboxId);
    if (existing) {
      await ensureSandboxReady(existing, fresh.id);
      await ensureProjectRepository(existing, fresh);
      return existing;
    }
  }
  logger.info("daytona sandbox create started", { op: "daytona_sandbox_create", projectId });
  const sandbox = await daytona.create({
    language: serverEnv().DAYTONA_DEFAULT_LANGUAGE ?? "typescript",
    autoStopInterval: 15,
    envVars: {
      MC_PROJECT_ID: projectId,
      MC_PROJECT_NAME: project.name,
    },
  });
  const id = sandboxId(sandbox);
  if (!id) throw new Error("Daytona sandbox was created without an id");
  logger.info("daytona sandbox created", { op: "daytona_sandbox_create", projectId, sandboxId: id });
  const workspacePath = projectWorkspacePath(project);
  await updateProject(projectId, {
    runtimeKind: "daytona",
    sandboxId: id,
    workspacePath,
    sandboxState: "started",
  });
  await ensureProjectRepository(sandbox, {
    ...project,
    sandboxId: id,
    workspacePath,
    sandboxState: "started",
  });
  return sandbox;
}

async function ensureSandboxReady(sandbox: DaytonaSandbox, projectId: string): Promise<void> {
  const id = sandboxId(sandbox);
  if (sandbox.state === "started") {
    await updateProject(projectId, { sandboxState: "started" });
    return;
  }
  if (!sandbox.state) return;
  if (sandbox.state === "error" && sandbox.recoverable && sandbox.recover) {
    logger.info("daytona sandbox recover started", { op: "daytona_sandbox_recover", projectId, sandboxId: id });
    await sandbox.recover(60);
    await sandbox.refreshData?.();
    await updateProject(projectId, { sandboxState: sandbox.state ?? "started" });
    return;
  }
  logger.info("daytona sandbox start started", {
    op: "daytona_sandbox_start",
    projectId,
    sandboxId: id,
    previousState: sandbox.state,
  });
  if (sandbox.start) {
    await sandbox.start(60);
  } else {
    const daytona = await getDaytona();
    if (!daytona.start) throw new Error("Daytona client does not expose sandbox start");
    await daytona.start(sandbox, 60);
  }
  await sandbox.refreshData?.();
  await updateProject(projectId, { sandboxState: sandbox.state ?? "started" });
}

async function ensureProjectRepository(
  sandbox: DaytonaSandbox,
  project: NonNullable<Awaited<ReturnType<typeof getProjectRow>>>,
) {
  if (!project.repoUrl) return;
  if (!sandbox.git) throw new Error("Daytona sandbox does not expose git operations");
  const workspacePath = projectWorkspacePath(project);
  const id = sandboxId(sandbox);
  if (workspacePath !== project.workspacePath) {
    await updateProject(project.id, { workspacePath });
  }
  const existingStatus = await sandbox.git.status(workspacePath).catch((err: unknown) => {
    logger.warn("daytona git status failed", {
      op: "daytona_git_status",
      projectId: project.id,
      sandboxId: id,
      workspacePath,
      err,
    });
    return null;
  });
  if (existingStatus) {
    if (existingStatus.currentBranch && existingStatus.currentBranch !== project.branch) {
      await updateProject(project.id, { branch: existingStatus.currentBranch });
    }
    return;
  }
  logger.info("daytona git clone started", {
    op: "daytona_git_clone",
    projectId: project.id,
    sandboxId: id,
    workspacePath,
  });
  await sandbox.git.clone(project.repoUrl, workspacePath);
  logger.info("daytona git clone finished", {
    op: "daytona_git_clone",
    projectId: project.id,
    sandboxId: id,
    workspacePath,
  });
  const clonedStatus = await sandbox.git.status(workspacePath).catch((err: unknown) => {
    logger.warn("daytona git status failed", {
      op: "daytona_git_status",
      projectId: project.id,
      sandboxId: id,
      workspacePath,
      err,
    });
    return null;
  });
  if (clonedStatus?.currentBranch && clonedStatus.currentBranch !== project.branch) {
    await updateProject(project.id, { branch: clonedStatus.currentBranch });
  }
}

function commandLine(opts: RuntimePtySpawn): string {
  const args = opts.args?.length ? ` ${opts.args.map(shellQuote).join(" ")}` : "";
  return `${opts.command}${args}`.trim();
}

export async function executeRuntimeCommand(
  projectId: string,
  command: string,
  opts: { cwd?: string; env?: Record<string, string>; timeoutMs?: number } = {},
): Promise<{ code: number; stdout: string }> {
  const sandbox = await ensureProjectSandbox(projectId);
  if (!sandbox.process.executeCommand) {
    throw new Error("Daytona sandbox does not expose command execution");
  }
  const timeoutSeconds = opts.timeoutMs ? Math.max(1, Math.ceil(opts.timeoutMs / 1000)) : undefined;
  const result = await sandbox.process.executeCommand(
    command,
    opts.cwd ?? (await resolveWorkspacePath(projectId)),
    opts.env,
    timeoutSeconds,
  );
  return {
    code: result.exitCode ?? 0,
    stdout: result.artifacts?.stdout ?? result.result ?? "",
  };
}

function getPtyServerCode(): string {
  return `
const http = require('http');
const fs = require('fs');
const WebSocket = require('ws');
const pty = require('node-pty');
const os = require('os');
const path = require('path');

const PORT = Number(process.env.PTY_PORT || ${PTY_SERVER_PORT});
const PROCESS_NAME = ${JSON.stringify(PTY_SERVER_PROCESS_NAME)};

const server = http.createServer((req, res) => {
  if (req.url === '/' || req.url === '/health') {
    res.writeHead(200, { 'content-type': 'text/plain', 'access-control-allow-origin': '*' });
    res.end(PROCESS_NAME + ' running');
    return;
  }
  res.writeHead(404);
  res.end('not found');
});

function send(ws, message) {
  if (ws.readyState !== WebSocket.OPEN) return;
  try {
    ws.send(JSON.stringify(message));
  } catch {}
}

function writeRcfile(id) {
  const file = '/tmp/.mission-control-pty-bashrc-' + id.replace(/[^a-zA-Z0-9_-]/g, '');
  fs.writeFileSync(
    file,
    "[ -f ~/.bashrc ] && source ~/.bashrc\\nunset PROMPT_COMMAND\\nPS1='\\\\[\\\\033[32m\\\\]\\\\u:\\\\w\\\\$\\\\[\\\\033[0m\\\\] '\\n"
  );
  return file;
}

function resolveCwd(requested) {
  const input = typeof requested === 'string' && requested ? requested : process.cwd();
  const candidates = [];
  const add = (candidate) => {
    if (candidate && !candidates.includes(candidate)) candidates.push(candidate);
  };
  if (path.isAbsolute(input)) {
    add(input);
  } else {
    add(path.resolve(process.cwd(), input));
    add(path.join('/home/daytona', input));
    add(path.join('/workspace', input.replace(/^workspace\\/?/, '')));
    add(input);
  }
  add(process.cwd());

  for (const candidate of candidates) {
    try {
      if (fs.statSync(candidate).isDirectory()) return candidate;
    } catch {}
  }
  throw new Error('cwd not found: ' + input + ' (tried ' + candidates.join(', ') + ')');
}

const wss = new WebSocket.Server({ server, path: '/' });

wss.on('connection', (ws) => {
  let proc = null;

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw));
    } catch {
      return;
    }

    if (!proc) {
      if (msg.type !== 'start') return;
      const id = typeof msg.id === 'string' ? msg.id : String(Date.now());
      let cwd;
      try {
        cwd = resolveCwd(msg.cwd);
      } catch (err) {
        send(ws, { type: 'error', error: err && err.message ? err.message : String(err) });
        ws.close();
        return;
      }
      const cols = Number.isInteger(msg.cols) ? msg.cols : 100;
      const rows = Number.isInteger(msg.rows) ? msg.rows : 30;
      const env = {
        ...process.env,
        ...(msg.env && typeof msg.env === 'object' ? msg.env : {}),
        TERM: 'xterm-256color',
      };
      const shell = os.platform() === 'win32' ? 'powershell.exe' : 'bash';
      const args = os.platform() === 'win32' ? [] : ['--rcfile', writeRcfile(id), '-i'];
      try {
        proc = pty.spawn(shell, args, {
          name: 'xterm-256color',
          cols,
          rows,
          cwd,
          env,
        });
      } catch (err) {
        send(ws, { type: 'error', error: err && err.message ? err.message : String(err) });
        ws.close();
        return;
      }
      proc.onData((data) => send(ws, { type: 'data', payload: data }));
      proc.onExit(({ exitCode, signal }) => {
        send(ws, { type: 'exit', exitCode, signal });
        try { ws.close(); } catch {}
      });
      send(ws, { type: 'ready', pid: proc.pid });
      return;
    }

    if (msg.type === 'input' && typeof msg.payload === 'string') {
      proc.write(msg.payload);
    } else if (msg.type === 'resize') {
      const cols = Number.isInteger(msg.cols) ? msg.cols : 100;
      const rows = Number.isInteger(msg.rows) ? msg.rows : 30;
      try { proc.resize(cols, rows); } catch {}
    } else if (msg.type === 'ping') {
      send(ws, { type: 'pong', timestamp: Date.now() });
    }
  });

  ws.on('close', () => {
    if (!proc) return;
    try { proc.kill(); } catch {}
  });
  ws.on('error', () => {
    if (!proc) return;
    try { proc.kill(); } catch {}
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(PROCESS_NAME + ' listening on ' + PORT);
});

process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT', () => process.exit(0));
`.trim();
}

async function isPtyServerRunning(sandbox: DaytonaSandbox): Promise<boolean> {
  if (!sandbox.process.executeCommand) return false;
  const result = await sandbox.process.executeCommand(
    `pgrep -f "[n]ode .*${PTY_SERVER_CODE_PATH}" > /dev/null && echo running || echo stopped`,
    undefined,
    undefined,
    10,
  );
  return (result.result ?? result.artifacts?.stdout ?? "").trim() === "running";
}

async function ensureSandboxPtyServer(sandbox: DaytonaSandbox, projectId: string): Promise<string> {
  if (!sandbox.process.executeCommand) {
    throw new Error("Daytona sandbox does not expose command execution");
  }
  if (!sandbox.getSignedPreviewUrl) {
    throw new Error("Daytona sandbox does not expose signed preview URLs");
  }

  if (!(await isPtyServerRunning(sandbox))) {
    await sandbox.fs.uploadFile(Buffer.from(getPtyServerCode(), "utf8"), PTY_SERVER_CODE_PATH);

    const install = await sandbox.process.executeCommand(
      `flock -w 120 /tmp/.mission-control-node-pty-install.lock bash -lc '${[
        "if [ -f /tmp/node_modules/node-pty/build/Release/pty.node ] && [ -d /tmp/node_modules/ws ]; then echo already-installed; exit 0; fi",
        "cd /tmp",
        "npm install --prefix /tmp ws node-pty 2>&1",
      ].join("; ")}'`,
      undefined,
      undefined,
      120,
    );
    const check = await sandbox.process.executeCommand(
      "test -f /tmp/node_modules/node-pty/build/Release/pty.node && test -d /tmp/node_modules/ws && echo ok || echo missing",
      undefined,
      undefined,
      10,
    );
    if ((check.result ?? check.artifacts?.stdout ?? "").trim() !== "ok") {
      throw new Error(
        `Failed to install sandbox PTY dependencies: ${install.result ?? install.artifacts?.stdout ?? ""}`,
      );
    }

    await sandbox.process.executeCommand(
      `pkill -f "[n]ode .*/tmp/mission-control-websocket-pty-server" 2>/dev/null || true`,
      undefined,
      undefined,
      10,
    );

    await sandbox.process.executeCommand(
      `nohup node ${shellQuote(PTY_SERVER_CODE_PATH)} > /tmp/mission-control-pty-server.log 2>&1 &`,
      undefined,
      undefined,
      10,
    );

    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      if (await isPtyServerRunning(sandbox)) break;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    if (!(await isPtyServerRunning(sandbox))) {
      const log = await sandbox.process.executeCommand(
        "tail -40 /tmp/mission-control-pty-server.log 2>/dev/null || true",
        undefined,
        undefined,
        10,
      );
      throw new Error(`Sandbox PTY server failed to start: ${log.result ?? log.artifacts?.stdout ?? ""}`);
    }
    logger.info("daytona pty server started", { op: "daytona_pty_server", projectId });
  }

  const signed = await sandbox.getSignedPreviewUrl(PTY_SERVER_PORT, 3600);
  return signed.url.replace(/^http:/, "ws:").replace(/^https:/, "wss:");
}

function connectWebSocket(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const timer = setTimeout(() => {
      try {
        ws.close();
      } catch {
        /* ignore */
      }
      reject(new Error("Sandbox PTY websocket connection timed out"));
    }, 10_000);
    ws.addEventListener("open", () => {
      clearTimeout(timer);
      resolve(ws);
    }, { once: true });
    ws.addEventListener("error", () => {
      clearTimeout(timer);
      reject(new Error("Sandbox PTY websocket connection failed"));
    }, { once: true });
  });
}

async function connectSandboxPty(
  websocketUrl: string,
  opts: {
    id: string;
    cwd: string;
    env: Record<string, string>;
    cols: number;
    rows: number;
    onData: (data: string) => void;
  },
): Promise<DaytonaPtyHandle> {
  const ws = await connectWebSocket(websocketUrl);
  let exitResult: { exitCode?: number; signal?: number } | null = null;
  let resolveExit: ((result: { exitCode?: number; signal?: number }) => void) | null = null;
  const exitPromise = new Promise<{ exitCode?: number; signal?: number }>((resolve) => {
    resolveExit = resolve;
  });
  const markExit = (result: { exitCode?: number; signal?: number }) => {
    if (exitResult) return;
    exitResult = result;
    resolveExit?.(result);
  };

  const ready = new Promise<void>((resolve, reject) => {
    const fail = (err: Error) => {
      try {
        ws.close();
      } catch {
        /* ignore */
      }
      reject(err);
    };
    const timer = setTimeout(() => fail(new Error("Sandbox PTY start timed out")), 10_000);
    const onMessage = (event: MessageEvent) => {
      try {
        const message = JSON.parse(String(event.data)) as {
          type?: string;
          payload?: string;
          exitCode?: number;
          signal?: number;
          error?: string;
        };
        if (message.type === "ready") {
          clearTimeout(timer);
          resolve();
          return;
        }
        if (message.type === "data" && typeof message.payload === "string") {
          opts.onData(message.payload);
        } else if (message.type === "exit") {
          markExit({ exitCode: message.exitCode ?? 0, signal: message.signal });
        } else if (message.type === "error") {
          clearTimeout(timer);
          fail(new Error(message.error || "Sandbox PTY failed to start"));
        }
      } catch {
        /* ignore malformed PTY messages */
      }
    };
    ws.addEventListener("message", onMessage);
  });

  ws.addEventListener("close", () => markExit({ exitCode: exitResult?.exitCode ?? 0 }));
  ws.send(JSON.stringify({
    type: "start",
    id: opts.id,
    cwd: opts.cwd,
    env: opts.env,
    cols: opts.cols,
    rows: opts.rows,
  }));
  await ready;

  const send = (message: unknown) => {
    if (ws.readyState !== WebSocket.OPEN) throw new Error("Sandbox PTY websocket is not connected");
    ws.send(JSON.stringify(message));
  };

  return {
    async sendInput(data: string) {
      send({ type: "input", payload: data });
    },
    async resize(cols: number, rows: number) {
      send({ type: "resize", cols, rows });
    },
    async wait() {
      return exitResult ?? await exitPromise;
    },
    async disconnect() {
      ws.close();
    },
  };
}

export async function spawnRuntimePty(opts: RuntimePtySpawn): Promise<{ ptyId: string }> {
  const sandbox = await ensureProjectSandbox(opts.projectId);
  const id = runtimePtyId(opts.projectId);
  const cwd = await resolveWorkspacePath(opts.projectId, opts.subPath);
  const pty: PtyState = {
    id,
    taskId: opts.taskId,
    projectId: opts.projectId,
    command: commandLine(opts),
    sandbox,
    handle: null as unknown as DaytonaPtyHandle,
    buffer: [],
    bufferBytes: 0,
  };
  const websocketUrl = await ensureSandboxPtyServer(sandbox, opts.projectId);
  const handle = await connectSandboxPty(websocketUrl, {
    id,
    cwd,
    cols: opts.cols ?? 100,
    rows: opts.rows ?? 30,
    env: {
      TERM: "xterm-256color",
      MC_TASK_ID: opts.taskId,
      ...(opts.mcEnv?.apiUrl ? { MC_API_URL: opts.mcEnv.apiUrl } : {}),
      ...(opts.mcEnv?.token ? { MC_TASK_TOKEN: opts.mcEnv.token } : {}),
    },
    onData(data) {
      appendBuffer(pty, data);
      emit({ type: "pty:data", projectId: opts.projectId, ptyId: id, data });
    },
  });
  pty.handle = handle;
  ptys.set(id, pty);
  const cmd = commandLine(opts);
  if (cmd) await handle.sendInput(`exec ${cmd}\n`);
  registerPtyExitWatcher(pty);
  return { ptyId: id };
}

function registerPtyExitWatcher(pty: PtyState): void {
  void pty.handle.wait?.().then((result) => {
    emit({
      type: "pty:exit",
      projectId: pty.projectId,
      ptyId: pty.id,
      exitCode: result.exitCode ?? 0,
      signal: result.signal,
    });
    ptys.delete(pty.id);
  }).catch((err: unknown) => {
    logger.warn("daytona pty wait failed", {
      op: "daytona_pty_wait",
      projectId: pty.projectId,
      taskId: pty.taskId,
      ptyId: pty.id,
      err,
    });
    emit({ type: "pty:exit", projectId: pty.projectId, ptyId: pty.id, exitCode: 1 });
    ptys.delete(pty.id);
  });
}

async function reconnectRuntimePty(ptyId: string, projectId: string): Promise<PtyState | null> {
  const existing = ptys.get(ptyId);
  if (existing) return existing;
  const reconnectKey = `${projectId}:${ptyId}`;
  const inflight = ptyConnectInflight.get(reconnectKey);
  if (inflight) return inflight;
  const next = (async () => {
    const sandbox = await ensureProjectSandbox(projectId);
    if (!sandbox.process.connectPty) return null;
    const pty: PtyState = {
      id: ptyId,
      taskId: "",
      projectId,
      command: "",
      sandbox,
      handle: null as unknown as DaytonaPtyHandle,
      buffer: [],
      bufferBytes: 0,
    };
    const handle = await sandbox.process.connectPty(ptyId, {
      onData(data) {
        const text = textDecoder.decode(data);
        appendBuffer(pty, text);
        emit({ type: "pty:data", projectId, ptyId, data: text });
      },
    });
    pty.handle = handle;
    ptys.set(ptyId, pty);
    registerPtyExitWatcher(pty);
    return pty;
  })()
    .catch((err: unknown) => {
      logger.warn("daytona pty reconnect failed", {
        op: "daytona_pty_reconnect",
        projectId,
        ptyId,
        err,
      });
      return null;
    })
    .finally(() => {
      if (ptyConnectInflight.get(reconnectKey) === next) ptyConnectInflight.delete(reconnectKey);
    });
  ptyConnectInflight.set(reconnectKey, next);
  return next;
}

async function queueRuntimePtyWrite(
  ptyId: string,
  write: () => Promise<boolean>,
): Promise<boolean> {
  const previous = ptyWriteQueues.get(ptyId) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(write);
  ptyWriteQueues.set(ptyId, next);
  try {
    return await next;
  } finally {
    if (ptyWriteQueues.get(ptyId) === next) ptyWriteQueues.delete(ptyId);
  }
}

export async function writeRuntimePty(
  ptyId: string,
  data: string,
  fallbackProjectId?: string,
): Promise<boolean> {
  return queueRuntimePtyWrite(ptyId, async () => {
    const existing = ptys.get(ptyId);
    if (existing && fallbackProjectId && existing.projectId !== fallbackProjectId) return false;
    const pty = existing ?? (fallbackProjectId ? await reconnectRuntimePty(ptyId, fallbackProjectId) : null);
    if (!pty) return false;
    await pty.handle.sendInput(data);
    return true;
  });
}

export async function resizeRuntimePty(ptyId: string, cols: number, rows: number): Promise<boolean> {
  const pty = ptys.get(ptyId);
  if (!pty) return false;
  if (pty.handle.resize) await pty.handle.resize(cols, rows);
  else await pty.sandbox.process.resizePtySession?.(ptyId, cols, rows);
  return true;
}

export async function killRuntimePty(ptyId: string): Promise<boolean> {
  const pty = ptys.get(ptyId);
  if (!pty) return false;
  await pty.handle.sendInput("exit\n").catch(() => undefined);
  await pty.handle.disconnect?.().catch(() => undefined);
  ptys.delete(ptyId);
  emit({ type: "pty:exit", projectId: pty.projectId, ptyId, exitCode: 0 });
  return true;
}

export async function killRuntimeLaunchProcesses(opts: {
  projectId: string;
  commands: string[];
  ports?: number[];
}) {
  const wanted = new Set(opts.commands.map((command) => command.trim()).filter(Boolean));
  let ptyCount = 0;
  for (const pty of [...ptys.values()]) {
    if (pty.projectId !== opts.projectId) continue;
    if (!wanted.has(pty.command.trim())) continue;
    if (await killRuntimePty(pty.id)) ptyCount++;
  }

  const ports = [];
  for (const port of opts.ports ?? []) {
    if (!Number.isInteger(port) || port <= 0 || port > 65535) continue;
    const result = await executeRuntimeCommand(
      opts.projectId,
      `pids="$(lsof -ti tcp:${port} 2>/dev/null || true)"; killed=""; errors=""; for pid in $pids; do if kill "$pid" 2>/dev/null; then killed="$killed $pid"; else errors="$errors $pid"; fi; done; printf 'pids=%s\\nkilled=%s\\nerrors=%s\\n' "$pids" "$killed" "$errors"`,
      { timeoutMs: 5000 },
    ).catch((err: unknown) => {
      logger.error("runtime port cleanup failed", { err, projectId: opts.projectId, port });
      return { code: 1, stdout: "errors=kill-failed" };
    });
    const lines = Object.fromEntries(
      result.stdout.split("\n").map((line) => {
        const idx = line.indexOf("=");
        return idx === -1 ? [line, ""] : [line.slice(0, idx), line.slice(idx + 1)];
      }),
    );
    const parseNums = (value: unknown) =>
      typeof value === "string"
        ? value.trim().split(/\s+/).filter(Boolean).map(Number).filter(Number.isFinite)
        : [];
    ports.push({
      port,
      pids: parseNums(lines.pids),
      killed: parseNums(lines.killed),
      errors: typeof lines.errors === "string" && lines.errors.trim() ? [lines.errors.trim()] : [],
    });
  }

  return { ptyCount, ports };
}

export function replayRuntimePty(ptyId: string): string {
  return ptys.get(ptyId)?.buffer.join("") ?? "";
}

export function getRuntimePtyProjectId(ptyId: string): string | null {
  return ptys.get(ptyId)?.projectId ?? projectIdFromRuntimePtyId(ptyId);
}

function isProbablyBinary(buf: Buffer): boolean {
  const len = Math.min(buf.length, 8192);
  for (let i = 0; i < len; i++) if (buf[i] === 0) return true;
  return false;
}

async function walkFiles(sandbox: DaytonaSandbox, root: string, relDir = "", out: string[] = []): Promise<string[]> {
  if (out.length >= MAX_LISTED_FILES) return out;
  const dir = relDir ? path.posix.join(root, relDir) : root;
  const entries = await sandbox.fs.listFiles(dir).catch(() => []);
  for (const entry of entries) {
    const rel = relDir ? path.posix.join(relDir, entry.name) : entry.name;
    if (entry.isDir) {
      if (["node_modules", ".git", "dist", "build", ".next", ".turbo"].includes(entry.name)) continue;
      await walkFiles(sandbox, root, rel, out);
    } else {
      out.push(rel);
      if (out.length >= MAX_LISTED_FILES) break;
    }
  }
  return out;
}

export async function listRuntimeFiles(projectId: string) {
  const sandbox = await ensureProjectSandbox(projectId);
  const files = await walkFiles(sandbox, await resolveWorkspacePath(projectId));
  return { ok: true as const, files };
}

export async function readRuntimeFile(projectId: string, relPath: string) {
  const sandbox = await ensureProjectSandbox(projectId);
  let abs: string;
  try {
    abs = await resolveWorkspacePath(projectId, relPath);
  } catch {
    return { ok: false as const, error: "invalid-path" as const };
  }
  try {
    const raw = await sandbox.fs.downloadFile(abs);
    const buf = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
    if (buf.byteLength > MAX_READ_BYTES) return { ok: false as const, error: "too-large" as const, lineCount: -1 };
    if (isProbablyBinary(buf)) return { ok: false as const, error: "binary" as const };
    const content = buf.toString("utf8");
    const lineCount = content ? content.split("\n").length : 1;
    if (lineCount > MAX_READ_LINES) return { ok: false as const, error: "too-large" as const, lineCount };
    return { ok: true as const, content, mtimeMs: (await getRuntimeFileMtimeMs(projectId, relPath)) ?? Date.now(), lineCount };
  } catch {
    return { ok: false as const, error: "not-found" as const };
  }
}

export async function readRuntimeFileBuffer(projectId: string, relPath: string): Promise<Buffer> {
  const sandbox = await ensureProjectSandbox(projectId);
  const abs = await resolveWorkspacePath(projectId, relPath);
  const raw = await sandbox.fs.downloadFile(abs);
  return Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
}

export async function getRuntimeFileMtimeMs(projectId: string, relPath: string): Promise<number | null> {
  const sandbox = await ensureProjectSandbox(projectId);
  let normalized: string | null;
  try {
    normalized = normalizeRelativePath(relPath);
  } catch {
    normalized = null;
  }
  if (!normalized) return null;
  const parentRel = path.posix.dirname(normalized);
  const name = path.posix.basename(normalized);
  const parent = parentRel === "." ? await resolveWorkspacePath(projectId) : await resolveWorkspacePath(projectId, parentRel);
  const entries = await sandbox.fs.listFiles(parent).catch(() => []);
  const match = entries.find((entry) => entry.name === name);
  if (!match?.modTime) return null;
  if (typeof match.modTime === "number") return match.modTime;
  const parsed = Date.parse(match.modTime);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function writeRuntimeFile(
  projectId: string,
  relPath: string,
  content: string,
  expectedMtimeMs?: number | null,
) {
  return withFileWriteLock(projectId, relPath, async () => writeRuntimeFileUnlocked(
    projectId,
    relPath,
    content,
    expectedMtimeMs,
  ));
}

async function writeRuntimeFileUnlocked(
  projectId: string,
  relPath: string,
  content: string,
  expectedMtimeMs?: number | null,
) {
  const sandbox = await ensureProjectSandbox(projectId);
  if (Buffer.byteLength(content, "utf8") > MAX_WRITE_BYTES) {
    return { ok: false as const, error: "too-large" as const };
  }
  let abs: string;
  try {
    abs = await resolveWorkspacePath(projectId, relPath);
  } catch {
    return { ok: false as const, error: "invalid-path" as const };
  }
  if (expectedMtimeMs != null) {
    const currentMtimeMs = await getRuntimeFileMtimeMs(projectId, relPath);
    if (currentMtimeMs == null || currentMtimeMs !== expectedMtimeMs) {
      return { ok: false as const, error: "stale" as const, currentMtimeMs };
    }
  }
  await sandbox.fs.uploadFile(Buffer.from(content, "utf8"), abs);
  return { ok: true as const, mtimeMs: (await getRuntimeFileMtimeMs(projectId, relPath)) ?? Date.now() };
}

export async function writeRuntimeFileBuffer(
  projectId: string,
  relPath: string,
  content: Buffer | Uint8Array,
): Promise<void> {
  const sandbox = await ensureProjectSandbox(projectId);
  const abs = await resolveWorkspacePath(projectId, relPath);
  await sandbox.fs.uploadFile(content, abs);
}

export async function deleteRuntimeFile(projectId: string, relPath: string): Promise<void> {
  const sandbox = await ensureProjectSandbox(projectId);
  const abs = await resolveWorkspacePath(projectId, relPath);
  if (sandbox.fs.deleteFile) {
    await sandbox.fs.deleteFile(abs, false);
    return;
  }
  await executeRuntimeCommand(projectId, `rm -- ${shellQuote(abs)}`, { timeoutMs: 5000 });
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

async function withFileWriteLock<T>(
  projectId: string,
  relPath: string,
  fn: () => Promise<T>,
): Promise<T> {
  const normalized = normalizeRelativePath(relPath) ?? relPath;
  const key = `${projectId}:${normalized}`;
  const previous = fileWriteLocks.get(key) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(fn);
  fileWriteLocks.set(key, next);
  try {
    return await next;
  } finally {
    if (fileWriteLocks.get(key) === next) fileWriteLocks.delete(key);
  }
}

export function watchRuntimeFile(_projectId: string, _relPath: string) {
  return { ok: false as const, error: "not-supported" };
}

export function unwatchRuntimeFile(watchId: string) {
  watchers.delete(watchId);
  return { ok: true as const };
}
