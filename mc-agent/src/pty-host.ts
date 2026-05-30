import * as fs from "node:fs";
import * as pty from "node-pty";
import { installAgentHooks } from "../../src/shared/agent-hooks";
import {
  resolveSpawnPlan,
  SpawnPolicyError,
  type SpawnRequest,
  type SpawnPolicyDeps,
  type SpawnPlan,
  type TaskAgentSpawn,
} from "../../src/shared/pty-spawn-policy";
import { buildSandboxMissionControlApiUrl } from "../../src/shared/mission-control-hook-env";
import { applyAgentPtyEnv } from "../../src/shared/agent-pty-env";
import { resolveAgentCommandOnPath, resolveCommandOnPath } from "./command-resolver";
import { resolveInsideWorkspace } from "./workspace-guard";
import type { ServerMessage, SpawnMessage } from "./protocol";
import { log } from "./logger";

// Mirrors electron/pty-manager.ts constants so sandbox terminals behave
// identically to host terminals (1 MB scrollback replay, 100x30 default size).
const RING_LIMIT_BYTES = 1_000_000;
const DEFAULT_COLS = 100;
const DEFAULT_ROWS = 30;

type BufferChunk = { seq: number; data: string; bytes: number };

type PtyRecord = {
  id: string;
  proc: pty.IPty;
  buffer: BufferChunk[];
  bufferBytes: number;
  nextSeq: number;
  killedByUser: boolean;
};

export type PtyHostOptions = {
  workspaceRoot: string;
  /** Connection id for correlating log lines (optional). */
  connId?: string;
  /** Base environment to derive child env from (defaults to process.env). */
  env?: NodeJS.ProcessEnv;
  /** Injectable spawn for tests. */
  spawnFn?: typeof pty.spawn;
};

/** Strip inherited MC_* / TERM_PROGRAM* vars so a parent's session can't leak in. */
function sanitizedEnv(base: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(base)) {
    if (v === undefined) continue;
    if (k === "TERM_PROGRAM" || k === "TERM_PROGRAM_VERSION") continue;
    if (k.startsWith("MC_")) continue;
    out[k] = v;
  }
  return out;
}

/**
 * Runs PTYs inside the sandbox container, mirroring the host PTY manager's
 * lifecycle (seq-numbered output, ring-buffer replay) and reusing the exact
 * same spawn allow-list. Agent hooks are bootstrapped to POST back to the host
 * via host.docker.internal.
 */
export class PtyHost {
  private readonly ptys = new Map<string, PtyRecord>();
  private readonly workspaceRoot: string;
  private readonly connId: string;
  private readonly baseEnv: NodeJS.ProcessEnv;
  private readonly spawnFn: typeof pty.spawn;
  private readonly policyDeps: SpawnPolicyDeps;

  constructor(
    private readonly emit: (msg: ServerMessage) => void,
    opts: PtyHostOptions,
  ) {
    this.workspaceRoot = opts.workspaceRoot;
    this.connId = opts.connId ?? "c?";
    this.baseEnv = opts.env ?? process.env;
    this.spawnFn = opts.spawnFn ?? pty.spawn;
    this.policyDeps = {
      projectRoots: () => [this.workspaceRoot],
      resolveCommand: (name) => resolveAgentCommandOnPath(name, this.baseEnv),
      resolveShell: () => {
        const shell = this.baseEnv.SHELL || "/bin/bash";
        // Verify the shell exists; fall back to /bin/sh which is always present.
        const resolved = resolveCommandOnPath(shell, this.baseEnv) ? shell : "/bin/sh";
        return {
          shell: resolved,
          shellArgs: (cmd) => (cmd ? ["-lc", cmd] : ["-l"]),
        };
      },
      platform: "linux",
    };
  }

  /** Resolve, hook-bootstrap, and spawn. Emits spawned/spawnError; returns nothing. */
  spawn(msg: SpawnMessage): void {
    const req: SpawnRequest = msg.shell
      ? {
          shell: true,
          taskId: msg.taskId,
          cwd: msg.cwd,
          command: msg.command,
          cols: msg.cols,
          rows: msg.rows,
        }
      : {
          agent: (msg.agent ?? "") as TaskAgentSpawn,
          taskId: msg.taskId,
          cwd: msg.cwd,
          command: msg.command,
          args: msg.args,
          cols: msg.cols,
          rows: msg.rows,
          dangerouslySkipPermissions: msg.dangerouslySkipPermissions,
        };

    const fail = (code: string, message: string): void => {
      log("error", "pty.spawn.fail", { connId: this.connId, ptyId: msg.ptyId, code, err: message });
      this.emit({ type: "spawnError", ptyId: msg.ptyId, code, message });
    };

    // A project that hasn't been cloned yet has no /workspace/<slug> dir, which
    // would make the spawn policy's cwd check fail. Create the slot (confined to
    // the workspace) so a terminal still opens; the user can then clone into it.
    this.ensureWorkspaceCwd(msg.cwd);

    let plan: SpawnPlan;
    try {
      plan = resolveSpawnPlan(req, this.policyDeps);
    } catch (err) {
      if (err instanceof SpawnPolicyError) fail(err.code, err.message);
      else fail("spawn-failed", err instanceof Error ? err.message : String(err));
      return;
    }

    // Install MC hooks into the project before the agent starts (host parity).
    if (plan.mode === "agent") {
      try {
        installAgentHooks(plan.agent, plan.cwd);
      } catch (err) {
        // Best-effort, exactly like the host: a hook-install failure must not
        // block the session — but record it, since silent hook breakage is the
        // exact "status stopped updating" failure mode.
        log("warn", "pty.hooks.install.fail", {
          connId: this.connId,
          agent: plan.agent,
          err: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const env = this.buildChildEnv(msg, plan);
    const target = plan.mode === "agent" ? plan.spawnTarget : plan.shellPath;
    const args = plan.mode === "agent" ? plan.spawnArgs : plan.shellArgs;

    let proc: pty.IPty;
    try {
      proc = this.spawnFn(target, args, {
        name: "xterm-256color",
        cols: msg.cols ?? DEFAULT_COLS,
        rows: msg.rows ?? DEFAULT_ROWS,
        cwd: plan.cwd,
        env,
      });
    } catch (err) {
      fail("spawn-failed", err instanceof Error ? err.message : String(err));
      return;
    }

    // nextSeq is "the seq the next chunk will get" — matches electron/pty-manager.ts
    // so the client's reconnect/replay contract is identical to host mode.
    const record: PtyRecord = {
      id: msg.ptyId,
      proc,
      buffer: [],
      bufferBytes: 0,
      nextSeq: 1,
      killedByUser: false,
    };
    this.ptys.set(msg.ptyId, record);

    log("info", "pty.spawn.ok", {
      connId: this.connId,
      ptyId: msg.ptyId,
      mode: plan.mode,
      cwd: plan.cwd,
    });
    // Ack BEFORE wiring data/exit so `spawned` can never be preceded by an
    // `output`/`exit` frame (node-pty may emit synchronously on attach).
    this.emit({ type: "spawned", ptyId: msg.ptyId });

    proc.onData((data) => {
      const seq = this.appendBuffer(record, data);
      this.emit({ type: "output", ptyId: record.id, seq, data });
    });

    proc.onExit(({ exitCode, signal }) => {
      this.ptys.delete(record.id);
      this.emit({ type: "exit", ptyId: record.id, exitCode, signal });
    });
  }

  write(ptyId: string, data: string): boolean {
    const p = this.ptys.get(ptyId);
    if (!p) return false;
    p.proc.write(data);
    return true;
  }

  resize(ptyId: string, cols: number, rows: number): boolean {
    const p = this.ptys.get(ptyId);
    if (!p) return false;
    try {
      p.proc.resize(cols, rows);
    } catch {
      // node-pty throws if the dimensions are invalid or the pty just exited.
    }
    return true;
  }

  kill(ptyId: string): boolean {
    const p = this.ptys.get(ptyId);
    if (!p) return false;
    p.killedByUser = true;
    try {
      p.proc.kill();
    } catch {
      // already gone
    }
    this.ptys.delete(ptyId);
    return true;
  }

  replay(ptyId: string): void {
    const p = this.ptys.get(ptyId);
    const data = p ? p.buffer.map((c) => c.data).join("") : "";
    const nextSeq = p ? p.nextSeq : 0;
    this.emit({ type: "replayResult", ptyId, data, nextSeq });
  }

  killAll(): void {
    for (const p of this.ptys.values()) {
      p.killedByUser = true;
      try {
        p.proc.kill();
      } catch {
        // ignore
      }
    }
    this.ptys.clear();
  }

  /** Create the spawn cwd if it's inside the workspace and missing (best-effort). */
  private ensureWorkspaceCwd(cwd: string): void {
    const abs = resolveInsideWorkspace(this.workspaceRoot, cwd);
    if (!abs) return; // outside the workspace — let the spawn policy reject it
    try {
      fs.mkdirSync(abs, { recursive: true });
    } catch {
      /* best effort — resolveSpawnPlan will surface a real cwd error */
    }
  }

  private appendBuffer(p: PtyRecord, data: string): number {
    const seq = p.nextSeq;
    p.nextSeq += 1;
    const bytes = Buffer.byteLength(data, "utf8");
    p.buffer.push({ seq, data, bytes });
    p.bufferBytes += bytes;
    while (p.bufferBytes > RING_LIMIT_BYTES && p.buffer.length > 1) {
      const evicted = p.buffer.shift()!;
      p.bufferBytes -= evicted.bytes;
    }
    return seq;
  }

  private buildChildEnv(msg: SpawnMessage, plan: SpawnPlan): Record<string, string> {
    const env = sanitizedEnv(this.baseEnv);
    env.MC_TASK_ID = msg.taskId;
    env.MC_THEME = msg.missionControlTheme === "light" ? "light" : "dark";
    if (plan.mode === "agent" && msg.mcEnv) {
      const apiUrl = buildSandboxMissionControlApiUrl(msg.mcEnv.port);
      if (apiUrl) env.MC_API_URL = apiUrl;
      if (msg.mcEnv.token) env.MC_API_TOKEN = msg.mcEnv.token;
      applyAgentPtyEnv(env, plan.agent);
    }
    return env;
  }
}
