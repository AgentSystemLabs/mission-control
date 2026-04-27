import type { IpcMain, BrowserWindow } from "electron";
import * as os from "node:os";
import * as fs from "node:fs";
import { installClaudeHooks } from "./claude-hooks";

function resolveShell(): string {
  const env = process.env.SHELL;
  if (env && fs.existsSync(env)) return env;
  if (os.platform() === "win32") return "powershell.exe";
  for (const candidate of ["/bin/zsh", "/bin/bash", "/bin/sh"]) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return "/bin/sh";
}

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
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (typeof v === "string") out[k] = v;
  }
  return out;
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

const INTERRUPT_MARKER = "Interrupted by user";
const INTERRUPT_COOLDOWN_MS = 2000;
const SCAN_TAIL_MAX = 256;

function scanForInterrupt(p: Pty, chunk: string) {
  if (p.agent !== "claude-code") return;
  if (!p.mcEnv?.apiUrl || !p.mcEnv?.token) return;
  const haystack = (p.scanTail + chunk).slice(-SCAN_TAIL_MAX - chunk.length);
  p.scanTail = haystack.slice(-SCAN_TAIL_MAX);
  if (!haystack.includes(INTERRUPT_MARKER)) return;
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
  } catch {
    /* swallow — best-effort status sync */
  }
}

const ptys = new Map<string, Pty>();
const RING_LIMIT_BYTES = 1_000_000;

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

export function registerPtyHandlers(ipcMain: IpcMain, getWin: () => BrowserWindow | null) {
  ipcMain.handle(
    "pty:spawn",
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

      // For Claude Code agents, register hooks into the project's
      // `.claude/settings.local.json` so we get callbacks when the agent
      // starts a turn, finishes, or needs human input.
      if (opts.agent === "claude-code") {
        installClaudeHooks(opts.cwd);
      }

      const env = sanitizeEnv();
      env.MC_TASK_ID = opts.taskId;
      if (opts.mcEnv?.apiUrl) env.MC_API_URL = opts.mcEnv.apiUrl;
      if (opts.mcEnv?.token) env.MC_API_TOKEN = opts.mcEnv.token;

      // If a command was supplied, run it inside a login shell via `-l -c`.
      // Login shell loads the user's PATH; `-c` forks the command directly so
      // we don't depend on a 60ms write-after-spawn race for the prompt.
      // After the command exits we drop into an interactive shell so the
      // user can keep working in the same project directory.
      let shellArgs: string[];
      if (opts.command && !isWindows) {
        const cmd = [opts.command, ...(opts.args ?? [])].join(" ");
        // exec the agent CLI; when it exits, hand control back to an
        // interactive login shell in the same cwd.
        shellArgs = ["-l", "-c", `${cmd}; exec ${userShell} -l`];
      } else {
        shellArgs = isWindows ? [] : ["-l"];
      }

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
        scanForInterrupt(p, data);
        send(getWin, "pty:data", { ptyId: id, data });
      });
      proc.onExit(({ exitCode, signal }: { exitCode: number; signal?: number }) => {
        send(getWin, "pty:exit", { ptyId: id, exitCode, signal });
        ptys.delete(id);
      });

      return { ptyId: id };
    }
  );

  ipcMain.handle("pty:write", (_evt, { ptyId, data }: { ptyId: string; data: string }) => {
    const p = ptys.get(ptyId);
    if (!p) return false;
    p.proc.write(data);
    return true;
  });

  ipcMain.handle(
    "pty:resize",
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

  ipcMain.handle("pty:kill", (_evt, { ptyId }: { ptyId: string }) => {
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

  ipcMain.handle("pty:replay", (_evt, { ptyId }: { ptyId: string }) => {
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
