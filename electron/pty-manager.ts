import type { IpcMain, BrowserWindow } from "electron";
import * as os from "node:os";
import * as fs from "node:fs";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { installAgentHooks } from "./agent-hooks";
import { IPC } from "./ipc-channels";
import { resolveShell, sanitizedProcessEnv, shellArgsForCommand } from "./shell-env";

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
      const raw = fs.readFileSync(file, "utf8");
      if (raw.trim()) settings = JSON.parse(raw);
    }
    if (settings.shiftEnterKeyBindingInstalled === true) return;
    settings.shiftEnterKeyBindingInstalled = true;
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(settings, null, 2) + "\n", "utf8");
  } catch {
    // best-effort — user can still run `/terminal-setup` manually.
  }
}

type Pty = {
  id: string;
  taskId: string;
  proc: any;
  buffer: string[];
  bufferBytes: number;
  cwd: string;
  command: string;
  agent?: string;
  mcEnv?: { apiUrl?: string; token?: string };
  scanTail: string;
  lastInterruptAt: number;
};

const INTERRUPT_COOLDOWN_MS = 2000;
const SCAN_TAIL_MAX = 256;

export function hasClaudeInterruptPrompt(text: string): boolean {
  return (
    text.includes("Interrupted by user") ||
    (text.includes("Interrupted") &&
      text.includes("What should Claude do instead"))
  );
}

export function hasCodexHookReviewPrompt(text: string): boolean {
  const normalized = text.replace(/\s+/g, " ").toLowerCase();
  return (
    normalized.includes("hooks need review before they can run") ||
    normalized.includes("open /hooks to review")
  );
}

function scanTail(p: Pty, chunk: string): string {
  const haystack = (p.scanTail + chunk).slice(-SCAN_TAIL_MAX - chunk.length);
  p.scanTail = haystack.slice(-SCAN_TAIL_MAX);
  return haystack;
}

function scanForInterrupt(p: Pty, haystack: string) {
  if (p.agent !== "claude-code") return;
  if (!p.mcEnv?.apiUrl || !p.mcEnv?.token) return;
  if (!hasClaudeInterruptPrompt(haystack)) return;
  const now = Date.now();
  if (now - p.lastInterruptAt < INTERRUPT_COOLDOWN_MS) return;
  p.lastInterruptAt = now;
  void postSyntheticHook(p, "UserInterrupt");
}

function scanForCodexHookReview(p: Pty, haystack: string) {
  if (p.agent !== "codex") return;
  if (!p.mcEnv?.apiUrl || !p.mcEnv?.token) return;
  if (!hasCodexHookReviewPrompt(haystack)) return;
  void postSyntheticHook(p, "PermissionRequest");
}

function hookEndpointSlug(agent: string | undefined): string {
  if (agent === "codex") return "codex";
  if (agent === "cursor-cli") return "cursor";
  return "claude";
}

async function postSyntheticHook(p: Pty, event: string) {
  try {
    const slug = hookEndpointSlug(p.agent);
    const url = `${p.mcEnv!.apiUrl}/api/hooks/${slug}?taskId=${encodeURIComponent(p.taskId)}`;
    await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${p.mcEnv!.token}`,
      },
      body: JSON.stringify({ hook_event_name: event }),
    });
  } catch {
    /* swallow — best-effort status sync */
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
  } catch {
    return false;
  } finally {
    ptys.delete(p.id);
  }
}

export function registerPtyHandlers(ipcMain: IpcMain, getWin: () => BrowserWindow | null) {
  ensureClaudeShiftEnterBinding();
  ipcMain.handle(
      IPC.ptySpawn,
    (
      _evt,
      opts: {
        taskId: string;
        cwd: string;
        command: string;
        args?: string[];
        cols?: number;
        rows?: number;
        agent?: string;
        mcEnv?: { apiUrl?: string; token?: string };
      }
    ) => {
      const pty = loadNodePty();
      const isWindows = os.platform() === "win32";
      const userShell = resolveShell();
      assertCwd(opts.cwd);

      installAgentHooks(opts.agent, opts.cwd);

      const env = sanitizeEnv();
      env.MC_TASK_ID = opts.taskId;
      if (opts.mcEnv?.apiUrl) env.MC_API_URL = opts.mcEnv.apiUrl;
      if (opts.mcEnv?.token) env.MC_API_TOKEN = opts.mcEnv.token;

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
          cwd: opts.cwd,
          env,
        });
      } catch (err: any) {
        const msg = err?.message ?? String(err);
        if (msg.includes("posix_spawnp")) {
          throw new Error(
            `posix_spawnp failed for shell="${userShell}" cwd="${opts.cwd}". ` +
              `Verify the shell exists and the cwd is a readable directory. ` +
              `Original: ${msg}`
          );
        }
        throw err;
      }

      const id = `pty-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const p: Pty = {
        id,
        taskId: opts.taskId,
        proc,
        buffer: [],
        bufferBytes: 0,
        cwd: opts.cwd,
        command: opts.command,
        agent: opts.agent,
        mcEnv: opts.mcEnv,
        scanTail: "",
        lastInterruptAt: 0,
      };
      ptys.set(id, p);

      proc.onData((data: string) => {
        appendBuffer(p, data);
        const haystack = scanTail(p, data);
        scanForInterrupt(p, haystack);
        scanForCodexHookReview(p, haystack);
        send(getWin, IPC.ptyData, { ptyId: id, data });
      });
      proc.onExit(({ exitCode, signal }: { exitCode: number; signal?: number }) => {
        send(getWin, IPC.ptyExit, { ptyId: id, exitCode, signal });
        ptys.delete(id);
      });

      return { ptyId: id };
    }
  );

  ipcMain.handle(IPC.ptyWrite, (_evt, { ptyId, data }: { ptyId: string; data: string }) => {
    const p = ptys.get(ptyId);
    if (!p) return false;
    p.proc.write(data);
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
    try {
      p.proc.kill();
    } catch {
      /* swallow */
    }
    ptys.delete(ptyId);
    return true;
  });

  ipcMain.handle(
    IPC.ptyKillLaunchProcesses,
    async (
      _evt,
      opts: { cwd: string; commands: string[]; ports?: number[] }
    ): Promise<{ ptyCount: number; ports: PortKillResult[] }> => {
      const wanted = new Set((opts.commands ?? []).map(normalizedCommand).filter(Boolean));
      const targets = [...ptys.values()].filter(
        (p) => p.cwd === opts.cwd && wanted.has(normalizedCommand(p.command))
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
