import type { IpcMain, BrowserWindow } from "electron";
import * as os from "node:os";
import * as fs from "node:fs";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { installAgentHooks } from "./agent-hooks";
import { IPC } from "./ipc-channels";
import { resolveShell, sanitizedProcessEnv, shellArgsForCommand } from "./shell-env";
import { logger } from "./logger";
import { z } from "zod";

// Validate the renderer-supplied spawn payload at the IPC boundary. A
// compromised or buggy renderer can't slip a non-string command or stuff
// surprise fields into mcEnv past this gate.
const ptySpawnOptsSchema = z.object({
  taskId: z.string().min(1).max(128),
  projectId: z.string().min(1).max(128),
  subPath: z.string().max(4096).optional(),
  command: z.string().max(8192),
  args: z.array(z.string().max(8192)).max(256).optional(),
  cols: z.number().int().positive().max(10_000).optional(),
  rows: z.number().int().positive().max(10_000).optional(),
  agent: z.string().max(128).optional(),
  mcEnv: z
    .object({
      apiUrl: z.string().max(2048).optional(),
      token: z.string().max(4096).optional(),
    })
    .optional(),
});
type PtySpawnOpts = z.infer<typeof ptySpawnOptsSchema>;

// Tail-window for batching pty output. node-pty can fire dozens of small
// chunks per second during fast output; coalescing into ~16ms frames (~60fps)
// collapses the per-chunk structured-clone + downstream DB-write overhead into
// one IPC send per frame without changing the on-the-wire message shape.
const PTY_FLUSH_INTERVAL_MS = 16;

function assertCwd(cwd: string): void {
  if (!cwd) throw new Error("cwd is required");
  let stat: fs.Stats;
  try {
    stat = fs.statSync(cwd);
  } catch {
    throw new Error(`cwd does not exist: ${cwd}`);
  }
  if (!stat.isDirectory()) throw new Error(`cwd is not a directory: ${cwd}`);
  try {
    fs.accessSync(cwd, fs.constants.R_OK | fs.constants.X_OK);
  } catch {
    throw new Error(`cwd is not accessible (check permissions): ${cwd}`);
  }
}

/**
 * Resolve a renderer-supplied (projectId, subPath?) into an absolute cwd that
 * provably lives inside the project root the server has on file. Rejects path
 * traversal, symlink escapes, and unknown project ids — a compromised renderer
 * can't spawn a pty in /etc by passing `cwd: "/"` anymore because there is no
 * cwd field; only a projectId we look up server-side.
 */
function resolveCwdForProject(projectRoot: string, subPath: string | undefined): string {
  const root = path.resolve(projectRoot);
  if (!subPath) {
    // Realpath the root itself — protects against the server-stored path being
    // a symlink that resolves outside its declared parent.
    return fs.realpathSync(root);
  }
  if (subPath.includes("\0")) throw new Error("invalid subPath");
  const abs = path.resolve(root, subPath);
  const rel = path.relative(root, abs);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error("subPath escapes project root");
  }
  const realRoot = fs.realpathSync(root);
  const realAbs = fs.realpathSync(abs);
  const realRel = path.relative(realRoot, realAbs);
  if (realRel.startsWith("..") || path.isAbsolute(realRel)) {
    throw new Error("subPath symlinks outside project root");
  }
  return realAbs;
}

function sanitizeEnv(): Record<string, string> {
  const out = sanitizedProcessEnv();
  // The PTY is xterm.js, not whichever terminal launched Electron. Leaking
  // TERM_PROGRAM=ghostty (or iTerm.app, etc.) makes Claude Code take terminal-
  // specific code paths that don't match what we actually emit — e.g. it skips
  // installing the Shift+Enter keybinding when it thinks Ghostty is handling it
  // natively, but xterm.js sends `\x1b\r` (the iTerm sequence) instead of LF.
  delete out.TERM_PROGRAM;
  delete out.TERM_PROGRAM_VERSION;
  return out;
}

// Claude Code only treats ESC+CR (`\x1b\r`, what `terminal-keymap.ts` emits for
// Shift+Enter) as "insert newline" when this flag is set. Normally `/terminal-
// setup` writes it; do it eagerly so the user doesn't have to.
function ensureClaudeShiftEnterBinding(): void {
  try {
    const dir = path.join(os.homedir(), ".claude");
    const file = path.join(dir, "settings.json");
    let settings: Record<string, unknown> = {};
    if (fs.existsSync(file)) {
      let raw: string;
      try {
        raw = fs.readFileSync(file, "utf8");
      } catch (err) {
        // Abort — don't clobber an existing-but-unreadable settings file.
        logger.warn("ensureClaudeShiftEnterBinding read failed", {
          err,
          op: "claude.settings.read",
          file,
        });
        return;
      }
      if (raw.trim()) {
        let parsed: unknown;
        try {
          parsed = JSON.parse(raw);
        } catch (err) {
          logger.warn("ensureClaudeShiftEnterBinding parse failed", {
            err,
            op: "claude.settings.parse",
            file,
          });
          return;
        }
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          logger.warn("ensureClaudeShiftEnterBinding parse: not an object", {
            op: "claude.settings.parse",
            file,
          });
          return;
        }
        settings = parsed as Record<string, unknown>;
      }
    }
    if (settings.shiftEnterKeyBindingInstalled === true) return;
    settings.shiftEnterKeyBindingInstalled = true;
    fs.mkdirSync(dir, { recursive: true });
    const tmp = path.join(
      dir,
      `settings.json.tmp-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    );
    fs.writeFileSync(tmp, JSON.stringify(settings, null, 2) + "\n", "utf8");
    fs.renameSync(tmp, file);
  } catch (err) {
    // best-effort — user can still run `/terminal-setup` manually.
    logger.warn("ensureClaudeShiftEnterBinding failed", {
      err,
      op: "claude.settings.write",
    });
  }
}

type Pty = {
  id: string;
  taskId: string;
  // NOTE: projectId is captured at spawn so per-op handlers (pty:write,
  // pty:resize, pty:kill, pty:replay) can future-scope by project. Today those
  // handlers only key on ptyId; this is defense-in-depth for a later change.
  projectId: string;
  proc: any;
  buffer: string[];
  bufferBytes: number;
  cwd: string;
  command: string;
  agent?: string;
  mcEnv?: { apiUrl?: string; token?: string };
  scanTail: string;
  lastInterruptAt: number;
  // Pending coalesced output + tail-window timer. See PTY_FLUSH_INTERVAL_MS.
  pendingChunks: string[];
  flushTimer: NodeJS.Timeout | null;
};

const INTERRUPT_COOLDOWN_MS = 2000;
const TASK_TOKEN_TTL_MS = 12 * 60 * 60 * 1000;

/**
 * Issue a per-task capability token whose only authority is the two routes a
 * spawned agent shell needs: POST /api/hooks/:slug and POST /api/tasks/:id/status.
 * Format mirrors src/server/services/task-token.ts — the global API token is
 * used as the shared HMAC secret (it never leaves the main/server boundary;
 * the spawned child receives only the per-task HMAC).
 */
function issueTaskToken(taskId: string, secret: string, ttlMs = TASK_TOKEN_TTL_MS): string {
  const expiry = Date.now() + ttlMs;
  const sig = createHmac("sha256", secret)
    .update(`${taskId}|${expiry}`)
    .digest("base64url");
  return `v1.${taskId}.${expiry}.${sig}`;
}
const SCAN_TAIL_MAX = 256;

export function hasClaudeInterruptPrompt(text: string): boolean {
  return (
    text.includes("Interrupted by user") ||
    (text.includes("Interrupted") &&
      text.includes("What should Claude do instead"))
  );
}

function scanForInterrupt(p: Pty, chunk: string) {
  if (p.agent !== "claude-code") return;
  if (!p.mcEnv?.apiUrl || !p.mcEnv?.token) return;
  const haystack = (p.scanTail + chunk).slice(-SCAN_TAIL_MAX - chunk.length);
  p.scanTail = haystack.slice(-SCAN_TAIL_MAX);
  if (!hasClaudeInterruptPrompt(haystack)) return;
  const now = Date.now();
  if (now - p.lastInterruptAt < INTERRUPT_COOLDOWN_MS) return;
  p.lastInterruptAt = now;
  void postSyntheticHook(p, "UserInterrupt");
}

async function postSyntheticHook(p: Pty, event: string) {
  try {
    const url = `${p.mcEnv!.apiUrl}/api/hooks/claude?taskId=${encodeURIComponent(p.taskId)}`;
    await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${p.mcEnv!.token}`,
      },
      body: JSON.stringify({ hook_event_name: event }),
    });
  } catch (err) {
    logger.warn("synthetic hook post failed", {
      err,
      op: "agent.hook.synthetic",
      taskId: p.taskId,
      event,
    });
  }
}

const ptys = new Map<string, Pty>();
const RING_LIMIT_BYTES = 1_000_000;

type PortKillResult = {
  port: number;
  pids: number[];
  killed: number[];
  errors: string[];
};

let nodePty: typeof import("node-pty") | null = null;
function loadNodePty() {
  if (!nodePty) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    nodePty = require("node-pty");
  }
  return nodePty!;
}

function appendBuffer(p: Pty, chunk: string) {
  p.buffer.push(chunk);
  p.bufferBytes += Buffer.byteLength(chunk, "utf8");
  while (p.bufferBytes > RING_LIMIT_BYTES && p.buffer.length > 1) {
    const dropped = p.buffer.shift()!;
    p.bufferBytes -= Buffer.byteLength(dropped, "utf8");
  }
}

function send(getWin: () => BrowserWindow | null, channel: string, payload: any) {
  const win = getWin();
  if (!win || win.isDestroyed()) return;
  win.webContents.send(channel, payload);
}

function normalizedCommand(command: string): string {
  return command.trim();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pidsListeningOnPort(port: number): number[] {
  if (!Number.isInteger(port) || port <= 0 || port > 65535) return [];
  if (os.platform() === "win32") return [];

  const result = spawnSync("lsof", ["-nP", `-tiTCP:${port}`, "-sTCP:LISTEN"], {
    encoding: "utf8",
    timeout: 2000,
  });
  if (result.error || result.status !== 0) return [];

  const pids = (result.stdout || "")
    .split(/\s+/)
    .map((raw) => Number(raw))
    .filter((pid) => Number.isInteger(pid) && pid > 0 && pid !== process.pid);
  return [...new Set(pids)];
}

async function killPidsListeningOnPort(port: number): Promise<PortKillResult> {
  const pids = pidsListeningOnPort(port);
  const killed: number[] = [];
  const errors: string[] = [];

  for (const pid of pids) {
    try {
      process.kill(pid, "SIGTERM");
      killed.push(pid);
    } catch (err: any) {
      errors.push(`pid ${pid}: ${err?.message ?? String(err)}`);
      logger.warn("failed to reap pty", { err, pid, op: "pty.kill" });
    }
  }

  if (killed.length > 0) {
    const deadline = Date.now() + 1500;
    while (Date.now() < deadline && pidsListeningOnPort(port).some((pid) => killed.includes(pid))) {
      await sleep(100);
    }
    for (const pid of pidsListeningOnPort(port).filter((pid) => killed.includes(pid))) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        /* already exited or not permitted */
      }
    }
  }

  return { port, pids, killed, errors };
}

async function killPty(p: Pty): Promise<boolean> {
  let exited = false;
  try {
    const sub = p.proc.onExit(() => {
      exited = true;
    });
    p.proc.kill();
    const deadline = Date.now() + 1500;
    while (!exited && Date.now() < deadline) {
      await sleep(50);
    }
    sub?.dispose?.();
    return true;
  } catch (err) {
    logger.warn("killPty failed", {
      err,
      op: "pty.kill",
      ptyId: p.id,
      taskId: p.taskId,
    });
    return false;
  } finally {
    ptys.delete(p.id);
  }
}

export function registerPtyHandlers(
  ipcMain: IpcMain,
  getWin: () => BrowserWindow | null,
  resolveProjectPath: (projectId: string) => Promise<string | null>,
) {
  ensureClaudeShiftEnterBinding();
  ipcMain.handle(
      IPC.ptySpawn,
    async (_evt, rawOpts: unknown) => {
      const parsed = ptySpawnOptsSchema.safeParse(rawOpts);
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        const path = issue?.path?.join(".") || "<root>";
        const msg = `pty:spawn invalid payload (${path}: ${issue?.message ?? "invalid"})`;
        logger.warn("pty.spawn rejected", { op: "pty.spawn.validate", issues: parsed.error.issues });
        throw new Error(msg);
      }
      const opts: PtySpawnOpts = parsed.data;
      const pty = loadNodePty();
      const isWindows = os.platform() === "win32";
      const userShell = resolveShell();
      const projectRoot = await resolveProjectPath(opts.projectId);
      if (!projectRoot) throw new Error(`unknown projectId: ${opts.projectId}`);
      const cwd = resolveCwdForProject(projectRoot, opts.subPath);
      assertCwd(cwd);

      await installAgentHooks(opts.agent, cwd, {
        taskId: opts.taskId,
        onFailure: (info) => send(getWin, IPC.agentHooksInstallFailed, info),
      });

      const env = sanitizeEnv();
      env.MC_TASK_ID = opts.taskId;
      if (opts.mcEnv?.apiUrl) env.MC_API_URL = opts.mcEnv.apiUrl;
      // Per-task scoped capability token. The global API token deliberately is
      // NOT injected — any child process the agent spawns (npm postinstall,
      // etc.) would otherwise have full API authority via its env. The HMAC
      // here only authenticates the two routes a spawned shell needs.
      if (opts.mcEnv?.token) {
        env.MC_TASK_TOKEN = issueTaskToken(opts.taskId, opts.mcEnv.token);
      }

      // If a command was supplied, run it through the user's shell with
      // platform-appropriate arguments. This loads the user's PATH and forks the
      // command directly, so we don't depend on a write-after-spawn prompt race.
      // When the agent CLI exits, the pty exits too — the renderer treats that
      // as the signal to delete the task.
      const cmd = opts.command ? [opts.command, ...(opts.args ?? [])].join(" ") : undefined;
      const shellArgs = shellArgsForCommand(userShell, cmd, isWindows ? "win32" : os.platform());

      let proc: import("node-pty").IPty;
      try {
        proc = pty.spawn(userShell, shellArgs, {
          name: "xterm-256color",
          cols: opts.cols ?? 100,
          rows: opts.rows ?? 30,
          cwd,
          env,
        });
      } catch (err: any) {
        logger.error("pty.spawn failed", {
          err,
          op: "pty.spawn",
          cwd,
          shell: userShell,
          taskId: opts.taskId,
        });
        const msg = err?.message ?? String(err);
        if (msg.includes("posix_spawnp")) {
          throw new Error(
            `posix_spawnp failed for shell="${userShell}" cwd="${cwd}". ` +
              `Verify the shell exists and the cwd is a readable directory. ` +
              `Original: ${msg}`
          );
        }
        throw err;
      }

      const id = `pty-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      logger.info("pty.spawned", {
        pid: proc.pid,
        cwd,
        cols: opts.cols ?? 100,
        rows: opts.rows ?? 30,
        taskId: opts.taskId,
        ptyId: id,
        op: "pty.spawn",
      });

      const p: Pty = {
        id,
        taskId: opts.taskId,
        projectId: opts.projectId,
        proc,
        buffer: [],
        bufferBytes: 0,
        cwd,
        command: opts.command,
        agent: opts.agent,
        mcEnv: opts.mcEnv,
        scanTail: "",
        lastInterruptAt: 0,
        pendingChunks: [],
        flushTimer: null,
      };
      ptys.set(id, p);

      const flush = () => {
        if (p.flushTimer) {
          clearTimeout(p.flushTimer);
          p.flushTimer = null;
        }
        if (p.pendingChunks.length === 0) return;
        const data = p.pendingChunks.join("");
        p.pendingChunks = [];
        send(getWin, IPC.ptyData, { ptyId: id, data });
      };

      proc.onData((data: string) => {
        // Ring-buffer + interrupt-scan stay per-chunk: replay accuracy and the
        // interrupt-prompt match window shouldn't depend on the flush cadence.
        appendBuffer(p, data);
        scanForInterrupt(p, data);
        // Coalesce IPC sends within a ~16ms tail window so a burst of tiny
        // node-pty chunks becomes one ptyData message (and one downstream DB
        // write in the renderer).
        p.pendingChunks.push(data);
        if (!p.flushTimer) {
          p.flushTimer = setTimeout(flush, PTY_FLUSH_INTERVAL_MS);
        }
      });
      proc.onExit(({ exitCode, signal }: { exitCode: number; signal?: number }) => {
        logger.info("pty.exit", {
          taskId: opts.taskId,
          ptyId: id,
          exitCode,
          signal,
          op: "pty.exit",
        });
        // Drain any buffered output before the exit signal so the renderer
        // doesn't lose the last frame of the process's output.
        flush();
        send(getWin, IPC.ptyExit, { ptyId: id, exitCode, signal });
        ptys.delete(id);
      });

      return { ptyId: id };
    }
  );

  ipcMain.handle(IPC.ptyWrite, (_evt, { ptyId, data }: { ptyId: string; data: string }) => {
    const p = ptys.get(ptyId);
    if (!p) return false;
    // p.projectId is available here for future per-op scoping.
    try {
      p.proc.write(data);
    } catch (err) {
      logger.warn("pty.write failed", {
        err,
        op: "pty.write",
        ptyId: p.id,
        taskId: p.taskId,
      });
    }
    return true;
  });

  ipcMain.handle(
      IPC.ptyResize,
    (_evt, { ptyId, cols, rows }: { ptyId: string; cols: number; rows: number }) => {
      const p = ptys.get(ptyId);
      if (!p) return false;
      try {
        p.proc.resize(cols, rows);
      } catch {
        /* swallow */
      }
      return true;
    }
  );

  ipcMain.handle(IPC.ptyKill, (_evt, { ptyId }: { ptyId: string }) => {
    const p = ptys.get(ptyId);
    if (!p) return false;
    // p.projectId is available here for future per-op scoping.
    try {
      p.proc.kill();
    } catch (err) {
      logger.warn("ptyKill.ipc failed", {
        err,
        op: "pty.kill.ipc",
        ptyId,
      });
    }
    ptys.delete(ptyId);
    return true;
  });

  ipcMain.handle(
    IPC.ptyKillLaunchProcesses,
    async (
      _evt,
      opts: { projectId: string; commands: string[]; ports?: number[] }
    ): Promise<{ ptyCount: number; ports: PortKillResult[] }> => {
      const projectRoot = await resolveProjectPath(opts.projectId);
      if (!projectRoot) return { ptyCount: 0, ports: [] };
      let cwd: string;
      try {
        cwd = resolveCwdForProject(projectRoot, undefined);
      } catch {
        return { ptyCount: 0, ports: [] };
      }
      const wanted = new Set((opts.commands ?? []).map(normalizedCommand).filter(Boolean));
      const targets = [...ptys.values()].filter(
        (p) => p.cwd === cwd && wanted.has(normalizedCommand(p.command))
      );
      await Promise.all(targets.map((p) => killPty(p)));

      const ports = [...new Set(opts.ports ?? [])].filter(
        (port) => Number.isInteger(port) && port > 0 && port <= 65535
      );
      const portResults = await Promise.all(ports.map((port) => killPidsListeningOnPort(port)));
      return { ptyCount: targets.length, ports: portResults };
    }
  );

  ipcMain.handle(IPC.ptyReplay, (_evt, { ptyId }: { ptyId: string }) => {
    const p = ptys.get(ptyId);
    if (!p) return "";
    return p.buffer.join("");
  });
}

export function killAllPtys() {
  for (const p of ptys.values()) {
    try {
      p.proc.kill();
    } catch {
      /* swallow */
    }
  }
  ptys.clear();
}
