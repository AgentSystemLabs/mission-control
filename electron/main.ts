import {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  shell,
  protocol,
  net,
  session,
  clipboard,
  nativeImage,
  type NativeImage,
} from "electron";
import log from "electron-log/main";
import { pathToFileURL } from "node:url";
import * as path from "node:path";
import * as fs from "node:fs";
import * as http from "node:http";
import * as nodeNet from "node:net";
import * as os from "node:os";
import { spawn, ChildProcess, spawnSync } from "node:child_process";
import { registerPtyHandlers, killAllPtys } from "./pty-manager";
import { registerFileHandlers, disposeAllFileWatchers } from "./file-handlers";
import { IPC } from "./ipc-channels";
import { resolveAgentCommandOnPath } from "./agent-cli-resolution";
import { augmentProcessEnv, sanitizedProcessEnv } from "./shell-env";
import { registerUpdateManager } from "./update-manager";
import { registerSandboxManager, disposeSandboxManager } from "./sandbox-manager";
import {
  clearSessionTerminalDebugLogs,
  listSessionTerminalDebugLogs,
  recordSessionTerminalDebugLog,
  type SessionTerminalDebugLogInput,
} from "./session-terminal-debug-log";
import {
  disposeApiTokenStore,
  getOrCreateApiToken,
  regenerateApiToken,
} from "./api-token-store";
import { configureIpcAllowedOrigins, safeHandle } from "./ipc-safe-handle";
import { extractRemoteVmDeployError } from "../src/shared/remote-vm-deploy-error";
import { shortId } from "../src/shared/short-id";
import { errMsg } from "../src/shared/err-msg";
import { configureProjectRootsDb, disposeProjectRootsDb, loadProjectRoots } from "./project-roots";
import { resolveSafeOpenPath } from "./open-path-policy";
import { buildLocalMissionControlApiUrl } from "./pty-hook-env";
import { checkAgentCliVersion } from "./agent-cli-version";
import { AGENT_CLI_CONFIG_BY_COMMAND } from "./agent-cli-version-requirements";
import { disposeAppSettingsStore } from "./app-settings-store";
import { getBinding, matchElectronInput } from "./keybindings-reader";
import { resolveProductionServerEntry } from "./production-server-entry";
import { shouldAllowWebPermission } from "./notification-permissions";
import {
  getNativeOsNotificationPermission,
  showSessionFinishOsNotification,
  type SessionFinishOsNotificationPayload,
} from "./session-finish-notification";
import {
  DEFAULT_DEV_SERVER_PORT,
  nextTcpPort,
  productionRuntimePortStart,
} from "./runtime-port";

const APP_NAME = "MissionControl";

function defaultUserDataDir(): string {
  const home = os.homedir();
  if (process.platform === "darwin") {
    return path.join(home, "Library/Application Support", APP_NAME);
  }
  if (process.platform === "win32") {
    return path.join(home, "AppData/Roaming", APP_NAME);
  }
  return path.join(home, ".config", APP_NAME);
}

function configureUserDataDir(): string {
  // Keep Electron-side IPC stores aligned with src/db/client.ts. In dev the
  // generated dist-electron/package.json only declares CommonJS, so Electron's
  // package-name-derived default can become "Electron" or "mission-control",
  // splitting API tokens and project roots across separate SQLite files.
  const dir = (process.env.MC_USER_DATA_DIR || defaultUserDataDir()).trim();
  fs.mkdirSync(dir, { recursive: true });
  app.setName(APP_NAME);
  app.setPath("userData", dir);
  process.env.MC_USER_DATA_DIR = dir;
  return dir;
}

const missionControlUserDataDir = configureUserDataDir();

/** Env for spawning the bundled remote-vm CLI as a plain Node process. */
function remoteVmSpawnEnv(): NodeJS.ProcessEnv {
  return {
    ...sanitizedProcessEnv(),
    ELECTRON_RUN_AS_NODE: "1",
    MC_USER_DATA_DIR: missionControlUserDataDir,
  };
}

// Persists to ~/Library/Logs/<AppName>/main.log on macOS, %USERPROFILE%/AppData/Roaming/<AppName>/logs/main.log on Windows,
// and ~/.config/<AppName>/logs/main.log on Linux. This is the file users grep when
// the auto-updater goes silent — `console.*` from a packaged Electron app is invisible.
// Log lines may contain the user's local OS username inside artifact paths (e.g. /Users/<name>/Library/...).
// That's already on the user's own machine, so not a privacy risk unless they share the bundle externally.
log.initialize();
log.transports.file.level = "info";
log.transports.console.level = "debug";

function ignoreBrokenPipe(stream: NodeJS.WriteStream | undefined): void {
  stream?.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EPIPE") return;
    throw err;
  });
}
ignoreBrokenPipe(process.stdout);
ignoreBrokenPipe(process.stderr);

const isDev = process.env.NODE_ENV === "development";
const devServerHost = process.env.MC_DEV_HOST ?? "127.0.0.1";
const devServerPort = Number(process.env.MC_DEV_PORT ?? DEFAULT_DEV_SERVER_PORT);
const devUrl = process.env.MC_DEV_URL ?? `http://${devServerHost}:${devServerPort}`;

// HTTP readiness polling: wait up to DEV_SERVER_READY_TIMEOUT_MS for the
// server to respond, polling every HTTP_POLL_INTERVAL_MS while waiting.
const DEV_SERVER_READY_TIMEOUT_MS = 30_000;
const HTTP_POLL_INTERVAL_MS = 200;
const GIT_CONFIG_PROBE_TIMEOUT_MS = 2_000;
const REMOTE_VM_DEPLOY_TIMEOUT_MS = 30 * 60_000;
const REMOTE_VM_OUTPUT_MAX_CHARS = 80_000;

// Window sizing for the main BrowserWindow.
const MAIN_WINDOW_DEFAULT_WIDTH = 1440;
const MAIN_WINDOW_DEFAULT_HEIGHT = 900;
const MAIN_WINDOW_MIN_WIDTH = 1024;
const MAIN_WINDOW_MIN_HEIGHT = 640;
const TRAFFIC_LIGHT_POSITION_DARWIN = { x: 48, y: 16 } as const;

augmentProcessEnv();

let win: BrowserWindow | null = null;
let serverProcess: ChildProcess | null = null;
let runtimePort: number | null = null;

function pickPort(startPort: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const tryCandidate = (candidate: number | null) => {
      if (candidate === null) {
        reject(new Error(`Could not allocate port starting at ${startPort}`));
        return;
      }
      const srv = nodeNet.createServer();
      srv.unref();
      srv.on("error", (err: NodeJS.ErrnoException) => {
        if (err.code === "EADDRINUSE" || err.code === "EACCES") {
          tryCandidate(nextTcpPort(candidate));
          return;
        }
        reject(err);
      });
      srv.listen(candidate, devServerHost, () => {
        const addr = srv.address();
        if (addr && typeof addr === "object") {
          const port = addr.port;
          srv.close(() => resolve(port));
        } else {
          srv.close(() => tryCandidate(nextTcpPort(candidate)));
        }
      });
    };
    tryCandidate(startPort);
  });
}

function readPreviousRuntimePort(portFile: string): number | null {
  try {
    const raw = fs.readFileSync(portFile, "utf8").trim();
    const port = Number(raw);
    return Number.isInteger(port) && port > 0 && port < 65536 ? port : null;
  } catch {
    return null;
  }
}

type RemoteVmDeployInput = {
  provider: "aws";
  sandboxId?: string;
  name: string;
  region: string;
  size?: string;
  keyName?: string;
  identityFile?: string;
  accessCidr?: string;
  sshCidr?: string;
  localPort?: number;
  profile?: string;
  imageId?: string;
  subnetId?: string;
  securityGroupId?: string;
  noWait?: boolean;
  activate?: boolean;
  setupScript?: string;
  gitAuthMode?: "none" | "copy-host" | "generate";
  copyAgentCreds?: boolean;
  idleTimeoutMinutes?: number;
  imageStrategy?: "golden" | "full-install";
  projectId?: string;
};

type RemoteVmDeploySuccess = {
  ok: true;
  sandboxId: string;
  name: string;
  provider: string;
  publicIp: string;
  agentUrl: string;
  localPort: number | null;
  output: string;
};

type RemoteVmReconcileResult =
  | {
      ok: true;
      sandboxId: string;
      instanceState: string | null;
      status: string | null;
      changed: boolean;
    }
  | { ok: false; error: string };

type RemoteVmDeployJobStatus = "queued" | "running" | "succeeded" | "failed" | "canceled";

type RemoteVmDeployJobResult = Omit<RemoteVmDeploySuccess, "ok" | "output">;

type RemoteVmDeployLogEntry = {
  jobId: string;
  seq: number;
  ts: number;
  stream: "stdout" | "stderr" | "system";
  data: string;
};

type RemoteVmDeployJobSnapshot = {
  id: string;
  input: RemoteVmDeployInput;
  status: RemoteVmDeployJobStatus;
  createdAt: number;
  startedAt: number | null;
  updatedAt: number;
  finishedAt: number | null;
  nextSeq: number;
  result?: RemoteVmDeployJobResult;
  error?: string;
  exitCode?: number | null;
  signal?: NodeJS.Signals | null;
};

type RemoteVmDeployFailure = { ok: false; error: string; output?: string };

type RemoteVmDeployJob = RemoteVmDeployJobSnapshot & {
  child: ChildProcess | null;
  timeout: NodeJS.Timeout | null;
  logs: RemoteVmDeployLogEntry[];
  output: string;
  cancelRequested: boolean;
  timedOut: boolean;
  resolveDone: (result: RemoteVmDeploySuccess | RemoteVmDeployFailure) => void;
  done: Promise<RemoteVmDeploySuccess | RemoteVmDeployFailure>;
};

const REMOTE_VM_JOB_LOG_MAX_ENTRIES = 1_000;
const remoteVmDeployJobs = new Map<string, RemoteVmDeployJob>();

function trimRemoteVmOutput(output: string): string {
  return output.length > REMOTE_VM_OUTPUT_MAX_CHARS
    ? output.slice(output.length - REMOTE_VM_OUTPUT_MAX_CHARS)
    : output;
}

function appendArg(args: string[], flag: string, value: string | number | null | undefined): void {
  if (value === undefined || value === null || value === "") return;
  args.push(flag, String(value));
}

function appendBool(args: string[], flag: string, enabled: boolean | null | undefined): void {
  if (enabled) args.push(flag);
}

function remoteVmScriptCandidates(): string[] {
  const appPath = app.getAppPath();
  return Array.from(
    new Set([
      path.join(appPath, "scripts", "remote-vm.mjs"),
      path.resolve(appPath, "..", "scripts", "remote-vm.mjs"),
      path.resolve(process.cwd(), "scripts", "remote-vm.mjs"),
      path.join(process.resourcesPath, "app.asar", "scripts", "remote-vm.mjs"),
      path.join(process.resourcesPath, "app.asar.unpacked", "scripts", "remote-vm.mjs"),
      path.join(process.resourcesPath, "app", "scripts", "remote-vm.mjs"),
    ]),
  );
}

function remoteVmScriptPath(): string | null {
  return remoteVmScriptCandidates().find((candidate) => fs.existsSync(candidate)) ?? null;
}

function remoteVmSpawnCwd(script: string): string {
  const appPath = app.getAppPath();
  if (appPath.endsWith(".asar")) return path.dirname(appPath);
  const scriptRoot = path.dirname(path.dirname(script));
  return fs.existsSync(path.join(scriptRoot, "package.json")) ? scriptRoot : appPath;
}

function buildRemoteVmDeployArgs(input: RemoteVmDeployInput): string[] {
  const name = typeof input?.name === "string" ? input.name.trim() : "";
  if (!name) throw new Error("VM name is required.");

  const region = typeof input.region === "string" ? input.region.trim() : "";
  if (!region) throw new Error("Region is required.");

  const args = ["deploy", "aws", "--name", name, "--region", region, "--json"];
  appendArg(args, "--sandbox-id", input.sandboxId?.trim());
  appendArg(args, "--size", input.size?.trim());
  appendArg(args, "--identity-file", input.identityFile?.trim());
  appendArg(args, "--access-cidr", input.accessCidr?.trim() || input.sshCidr?.trim());
  appendArg(args, "--local-port", input.localPort);
  appendBool(args, "--activate", input.activate);
  appendBool(args, "--no-wait", input.noWait);

  const keyName = input.keyName?.trim();
  appendArg(args, "--key-name", keyName);
  appendArg(args, "--profile", input.profile?.trim());
  appendArg(args, "--image-id", input.imageId?.trim());
  appendArg(args, "--subnet-id", input.subnetId?.trim());
  appendArg(args, "--security-group-id", input.securityGroupId?.trim());
  appendArg(args, "--git-auth-mode", input.gitAuthMode?.trim());
  appendBool(args, "--copy-agent-creds", input.copyAgentCreds);
  // Idle auto-stop window in minutes (0 disables). Default lives in the CLI.
  if (typeof input.idleTimeoutMinutes === "number" && Number.isFinite(input.idleTimeoutMinutes)) {
    appendArg(args, "--idle-timeout", Math.max(0, Math.floor(input.idleTimeoutMinutes)));
  }
  // Default (golden) auto-resolves the maintained AMI in the CLI; only the
  // explicit setup-script choice needs to force the full-install path.
  appendBool(args, "--no-golden", input.imageStrategy === "full-install");
  // Multi-line user setup script: base64 so newlines/quoting survive argv + the
  // bootstrap heredoc untouched. The CLI decodes and writes it to a file on the VM.
  const setupScript = input.setupScript?.trim();
  if (setupScript) {
    appendArg(args, "--setup-script-b64", Buffer.from(setupScript, "utf8").toString("base64"));
  }
  appendArg(args, "--project-id", input.projectId?.trim());
  return args;
}

function parseRemoteVmDeployResult(output: string): RemoteVmDeploySuccess | null {
  const line = output
    .split(/\r?\n/)
    .reverse()
    .find((entry) => entry.startsWith("REMOTE_VM_RESULT_JSON="));
  if (!line) return null;
  try {
    const parsed = JSON.parse(line.slice("REMOTE_VM_RESULT_JSON=".length)) as {
      sandboxId?: unknown;
      name?: unknown;
      provider?: unknown;
      publicIp?: unknown;
      agentUrl?: unknown;
      localPort?: unknown;
    };
    if (
      typeof parsed.sandboxId !== "string" ||
      typeof parsed.name !== "string" ||
      typeof parsed.provider !== "string" ||
      typeof parsed.publicIp !== "string" ||
      typeof parsed.agentUrl !== "string" ||
      (typeof parsed.localPort !== "number" && parsed.localPort !== null)
    ) {
      return null;
    }
    return {
      ok: true,
      sandboxId: parsed.sandboxId,
      name: parsed.name,
      provider: parsed.provider,
      publicIp: parsed.publicIp,
      agentUrl: parsed.agentUrl,
      localPort: parsed.localPort,
      output: trimRemoteVmOutput(output),
    };
  } catch {
    return null;
  }
}

function newRemoteVmDeployJobId(): string {
  return shortId("remote-vm-deploy");
}

function newRemoteVmSandboxId(): string {
  return shortId("sb");
}

function remoteVmDeployInputWithSandboxId(input: RemoteVmDeployInput): RemoteVmDeployInput {
  const sandboxId = typeof input.sandboxId === "string" ? input.sandboxId.trim() : "";
  return {
    ...input,
    sandboxId: sandboxId || newRemoteVmSandboxId(),
  };
}

function snapshotRemoteVmDeployJob(job: RemoteVmDeployJob): RemoteVmDeployJobSnapshot {
  const {
    child: _child,
    timeout: _timeout,
    logs: _logs,
    output: _output,
    cancelRequested: _cancelRequested,
    timedOut: _timedOut,
    resolveDone: _resolveDone,
    done: _done,
    ...snapshot
  } = job;
  return snapshot;
}

function emitRemoteVmDeployUpdate(job: RemoteVmDeployJob): void {
  if (!win || win.isDestroyed()) return;
  win.webContents.send(IPC.remoteVmDeployUpdate, snapshotRemoteVmDeployJob(job));
}

function emitRemoteVmDeployLog(entry: RemoteVmDeployLogEntry): void {
  if (!win || win.isDestroyed()) return;
  win.webContents.send(IPC.remoteVmDeployLog, entry);
}

function appendRemoteVmDeployLog(
  job: RemoteVmDeployJob,
  stream: RemoteVmDeployLogEntry["stream"],
  data: string,
): void {
  if (!data) return;
  const entry: RemoteVmDeployLogEntry = {
    jobId: job.id,
    seq: job.nextSeq,
    ts: Date.now(),
    stream,
    data,
  };
  job.nextSeq += 1;
  job.updatedAt = entry.ts;
  job.logs.push(entry);
  if (job.logs.length > REMOTE_VM_JOB_LOG_MAX_ENTRIES) {
    job.logs.splice(0, job.logs.length - REMOTE_VM_JOB_LOG_MAX_ENTRIES);
  }
  if (stream !== "system") {
    job.output = trimRemoteVmOutput(job.output + data);
  } else {
    job.output = trimRemoteVmOutput(`${job.output}${data.endsWith("\n") ? data : `${data}\n`}`);
  }
  emitRemoteVmDeployLog(entry);
}

function finishRemoteVmDeployJob(
  job: RemoteVmDeployJob,
  patch: Pick<RemoteVmDeployJobSnapshot, "status"> &
    Partial<Pick<RemoteVmDeployJobSnapshot, "result" | "error" | "exitCode" | "signal">>,
): void {
  if (job.finishedAt !== null) return;
  if (job.timeout) {
    clearTimeout(job.timeout);
    job.timeout = null;
  }
  job.child = null;
  job.status = patch.status;
  job.result = patch.result;
  job.error = patch.error;
  job.exitCode = patch.exitCode;
  job.signal = patch.signal;
  job.finishedAt = Date.now();
  job.updatedAt = job.finishedAt;
  emitRemoteVmDeployUpdate(job);

  if (patch.status === "succeeded" && patch.result) {
    job.resolveDone({ ok: true, ...patch.result, output: trimRemoteVmOutput(job.output) });
    return;
  }

  job.resolveDone({
    ok: false,
    error: patch.error ?? "Remote VM deploy failed.",
    output: trimRemoteVmOutput(job.output).trim() || undefined,
  });
}

function createRemoteVmDeployJob(input: RemoteVmDeployInput): RemoteVmDeployJob {
  const now = Date.now();
  const deployInput = remoteVmDeployInputWithSandboxId(input);
  let resolveDone!: (result: RemoteVmDeploySuccess | RemoteVmDeployFailure) => void;
  const done = new Promise<RemoteVmDeploySuccess | RemoteVmDeployFailure>((resolve) => {
    resolveDone = resolve;
  });
  const job: RemoteVmDeployJob = {
    id: newRemoteVmDeployJobId(),
    input: deployInput,
    status: "queued",
    createdAt: now,
    startedAt: null,
    updatedAt: now,
    finishedAt: null,
    nextSeq: 1,
    child: null,
    timeout: null,
    logs: [],
    output: "",
    cancelRequested: false,
    timedOut: false,
    resolveDone,
    done,
  };
  remoteVmDeployJobs.set(job.id, job);
  emitRemoteVmDeployUpdate(job);
  return job;
}

function startRemoteVmDeployJob(input: RemoteVmDeployInput): RemoteVmDeployJob {
  const job = createRemoteVmDeployJob(input);
  const script = remoteVmScriptPath();
  let args: string[];
  try {
    if (!script) {
      throw new Error("Remote VM deploy script is missing from this Mission Control build.");
    }
    args = buildRemoteVmDeployArgs(job.input);
    log.info("sandbox.agent-creds.deploy", {
      event: "sandbox.agent-creds.deploy",
      jobId: job.id,
      sandboxId: job.input.sandboxId ?? null,
      provider: job.input.provider,
      copyAgentCreds: !!job.input.copyAgentCreds,
      gitAuthMode: job.input.gitAuthMode ?? null,
      copyAgentCredsFlagPresent: args.includes("--copy-agent-creds"),
    });
  } catch (err) {
    const error = errMsg(err);
    appendRemoteVmDeployLog(job, "system", `[remote-vm] ${error}\n`);
    finishRemoteVmDeployJob(job, { status: "failed", error });
    return job;
  }

  job.status = "running";
  job.startedAt = Date.now();
  job.updatedAt = job.startedAt;
  emitRemoteVmDeployUpdate(job);
  appendRemoteVmDeployLog(job, "system", `[remote-vm] starting deploy job ${job.id}\n`);

  const child = spawn(process.execPath, [script, ...args], {
    cwd: remoteVmSpawnCwd(script),
    env: remoteVmSpawnEnv(),
    stdio: ["ignore", "pipe", "pipe"],
  });
  job.child = child;
  job.timeout = setTimeout(() => {
    job.timedOut = true;
    appendRemoteVmDeployLog(job, "system", "[remote-vm] deploy timed out after 30 minutes\n");
    child.kill();
  }, REMOTE_VM_DEPLOY_TIMEOUT_MS);

  child.stdout.on("data", (chunk: Buffer) => appendRemoteVmDeployLog(job, "stdout", chunk.toString("utf8")));
  child.stderr.on("data", (chunk: Buffer) => appendRemoteVmDeployLog(job, "stderr", chunk.toString("utf8")));
  child.on("error", (err) => {
    appendRemoteVmDeployLog(job, "system", `[remote-vm] ${err.message}\n`);
    finishRemoteVmDeployJob(job, { status: "failed", error: err.message });
  });
  child.on("exit", (code, signal) => {
    const parsed = parseRemoteVmDeployResult(job.output);
    if (code === 0 && parsed) {
      if (job.input.sandboxId && parsed.sandboxId !== job.input.sandboxId) {
        const error = `Remote VM deploy returned sandbox ${parsed.sandboxId}, expected ${job.input.sandboxId}.`;
        appendRemoteVmDeployLog(job, "system", `[remote-vm] ${error}\n`);
        finishRemoteVmDeployJob(job, { status: "failed", error, exitCode: code, signal });
        return;
      }
      finishRemoteVmDeployJob(job, {
        status: "succeeded",
        result: {
          sandboxId: parsed.sandboxId,
          name: parsed.name,
          provider: parsed.provider,
          publicIp: parsed.publicIp,
          agentUrl: parsed.agentUrl,
          localPort: parsed.localPort,
        },
        exitCode: code,
        signal,
      });
      return;
    }
    const detail = extractRemoteVmDeployError(job.output);
    const error = job.cancelRequested
      ? "Remote VM deploy canceled."
      : job.timedOut
      ? "Remote VM deploy timed out after 30 minutes."
      : signal
      ? `Remote VM deploy exited by signal ${signal}.`
      : detail ??
        `Remote VM deploy failed${code === null ? "" : ` with exit code ${code}`}.`;
    finishRemoteVmDeployJob(job, {
      status: job.cancelRequested ? "canceled" : "failed",
      error,
      exitCode: code,
      signal,
    });
  });

  return job;
}

function cancelRemoteVmDeployJob(jobId: string): { ok: true } | { ok: false; error: string } {
  const job = remoteVmDeployJobs.get(jobId);
  if (!job) return { ok: false, error: "Unknown remote VM deploy job." };
  if (job.status !== "queued" && job.status !== "running") {
    return { ok: false, error: "Remote VM deploy job is not running." };
  }
  appendRemoteVmDeployLog(job, "system", "[remote-vm] cancel requested\n");
  job.cancelRequested = true;
  if (job.child && !job.child.killed) {
    job.child.kill();
    return { ok: true };
  }
  finishRemoteVmDeployJob(job, { status: "canceled", error: "Remote VM deploy canceled." });
  return { ok: true };
}

function runRemoteVmDeploy(input: RemoteVmDeployInput): Promise<
  RemoteVmDeploySuccess | { ok: false; error: string; output?: string }
> {
  return startRemoteVmDeployJob(input).done;
}

/**
 * Tear down a cloud VM: terminate the underlying instance and remove its sandbox
 * row. Delegates to the remote-vm CLI's `destroy` command (region/profile come
 * from the stored config + AWS_PROFILE), so a cancelled or stuck deploy never
 * leaves a billing instance behind.
 */
function destroyRemoteVm(
  sandboxId: string,
  opts?: { keepRow?: boolean },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const id = typeof sandboxId === "string" ? sandboxId.trim() : "";
  if (!id) return Promise.resolve({ ok: false, error: "A sandbox id is required to terminate a VM." });
  const script = remoteVmScriptPath();
  if (!script) {
    return Promise.resolve({
      ok: false,
      error: "Remote VM script is missing from this Mission Control build.",
    });
  }
  const args = [script, "destroy", id, "--yes"];
  // Terminate-only: leave the sandbox row for the server's delete path to clean up.
  if (opts?.keepRow) args.push("--keep-row");
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, {
      cwd: remoteVmSpawnCwd(script),
      env: remoteVmSpawnEnv(),
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    const collect = (chunk: Buffer) => {
      output += chunk.toString("utf8");
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    child.on("error", (err) => resolve({ ok: false, error: err.message }));
    child.on("exit", (code) => {
      if (code === 0) {
        resolve({ ok: true });
        return;
      }
      const lastLine =
        output.trim().split(/\r?\n/).filter(Boolean).pop() ||
        `Terminate failed${code === null ? "" : ` with exit code ${code}`}.`;
      resolve({ ok: false, error: lastLine });
    });
  });
}

function runRemoteVmLifecycle(
  command: "pause" | "resume",
  sandboxId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const id = typeof sandboxId === "string" ? sandboxId.trim() : "";
  if (!id) {
    return Promise.resolve({ ok: false, error: `A sandbox id is required to ${command} a VM.` });
  }
  const script = remoteVmScriptPath();
  if (!script) {
    return Promise.resolve({
      ok: false,
      error: "Remote VM script is missing from this Mission Control build.",
    });
  }
  const args = [script, command, id];
  if (command === "pause") args.push("--yes");
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, {
      cwd: remoteVmSpawnCwd(script),
      env: remoteVmSpawnEnv(),
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    const collect = (chunk: Buffer) => {
      output += chunk.toString("utf8");
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    child.on("error", (err) => resolve({ ok: false, error: err.message }));
    child.on("exit", (code) => {
      if (code === 0) {
        resolve({ ok: true });
        return;
      }
      const lastLine =
        output.trim().split(/\r?\n/).filter(Boolean).pop() ||
        `Remote VM ${command} failed${code === null ? "" : ` with exit code ${code}`}.`;
      resolve({ ok: false, error: lastLine });
    });
  });
}

function runRemoteVmReconcile(sandboxId: string): Promise<RemoteVmReconcileResult> {
  const id = typeof sandboxId === "string" ? sandboxId.trim() : "";
  if (!id) return Promise.resolve({ ok: false, error: "A sandbox id is required to reconcile a VM." });
  const script = remoteVmScriptPath();
  if (!script) {
    return Promise.resolve({
      ok: false,
      error: "Remote VM script is missing from this Mission Control build.",
    });
  }
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [script, "reconcile", id, "--json"], {
      cwd: remoteVmSpawnCwd(script),
      env: remoteVmSpawnEnv(),
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    const collect = (chunk: Buffer) => {
      output += chunk.toString("utf8");
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    child.on("error", (err) => resolve({ ok: false, error: err.message }));
    child.on("exit", (code) => {
      const line = output
        .split(/\r?\n/)
        .reverse()
        .find((entry) => entry.startsWith("REMOTE_VM_RECONCILE_JSON="));
      if (line) {
        try {
          const parsed = JSON.parse(line.slice("REMOTE_VM_RECONCILE_JSON=".length)) as {
            sandboxId?: unknown;
            instanceState?: unknown;
            status?: unknown;
            changed?: unknown;
          };
          resolve({
            ok: true,
            sandboxId: typeof parsed.sandboxId === "string" ? parsed.sandboxId : id,
            instanceState: typeof parsed.instanceState === "string" ? parsed.instanceState : null,
            status: typeof parsed.status === "string" ? parsed.status : null,
            changed: parsed.changed === true,
          });
          return;
        } catch {
          /* fall through to error path */
        }
      }
      const lastLine =
        output.trim().split(/\r?\n/).filter(Boolean).pop() ||
        `Remote VM reconcile failed${code === null ? "" : ` with exit code ${code}`}.`;
      resolve({ ok: false, error: lastLine });
    });
  });
}

function waitForHttp(url: string, timeoutMs = DEV_SERVER_READY_TIMEOUT_MS): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tick = () => {
      const req = http.get(url, (res) => {
        res.resume();
        if (res.statusCode && res.statusCode < 500) return resolve();
        if (Date.now() > deadline) return reject(new Error(`Timed out waiting for ${url}`));
        setTimeout(tick, HTTP_POLL_INTERVAL_MS);
      });
      req.on("error", () => {
        if (Date.now() > deadline) return reject(new Error(`Timed out waiting for ${url}`));
        setTimeout(tick, HTTP_POLL_INTERVAL_MS);
      });
    };
    tick();
  });
}

async function openExternalHttpUrl(url: string): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!url) return { ok: false, error: "empty" };
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, error: "invalid-url" };
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    return { ok: false, error: "unsupported-url-scheme" };
  }
  await shell.openExternal(parsed.toString());
  return { ok: true };
}

function configurePermissionHandlers(): void {
  const ses = session.defaultSession;
  ses.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(shouldAllowWebPermission(permission));
  });
  ses.setPermissionCheckHandler((_webContents, permission) => {
    return shouldAllowWebPermission(permission);
  });
}

async function startProductionServer(): Promise<string> {
  const portFile = path.join(missionControlUserDataDir, ".port");
  // Dev mode writes the fixed Vite port to the shared .port file for hook
  // wiring. A packaged app must not reuse that port or it blocks `pnpm dev`.
  const startPort = productionRuntimePortStart(readPreviousRuntimePort(portFile), {
    devServerPort,
  });
  const port = await pickPort(startPort);
  const origin = `http://${devServerHost}:${port}`;
  runtimePort = port;
  fs.mkdirSync(path.dirname(portFile), { recursive: true });
  fs.writeFileSync(portFile, String(port), "utf8");

  const { entry, checkedPaths } = resolveProductionServerEntry({
    appPath: app.getAppPath(),
    resourcesPath: process.resourcesPath,
    mainDirname: __dirname,
    exists: fs.existsSync,
  });
  if (!fs.existsSync(entry)) {
    throw new Error(`Could not find production server entry. Checked: ${checkedPaths.join(", ")}`);
  }

  const runner = path.join(__dirname, "server-runner.mjs");

  serverProcess = spawn(process.execPath, [runner], {
    env: {
      ...process.env,
      SERVER_ENTRY: entry,
      PORT: String(port),
      HOST: devServerHost,
      MC_SERVER_ORIGIN: origin,
      MC_DEV_URL: origin,
      MC_DEV_PORT: String(port),
      ELECTRON_RUN_AS_NODE: "1",
      MC_USER_DATA_DIR: missionControlUserDataDir,
    },
    stdio: ["ignore", "inherit", "inherit"],
  });

  serverProcess.on("exit", (code) => {
    console.error(`[server] exited with code ${code}`);
    if (!(app as any).isQuiting) {
      app.quit();
    }
  });

  await waitForHttp(origin);
  return origin;
}

async function bootDevServer(): Promise<string> {
  // Vite dev server is launched by `pnpm dev:server`; just wait for it.
  await waitForHttp(devUrl);
  runtimePort = Number(new URL(devUrl).port);
  const portFile = path.join(missionControlUserDataDir, ".port");
  fs.mkdirSync(path.dirname(portFile), { recursive: true });
  fs.writeFileSync(portFile, String(runtimePort), "utf8");
  return devUrl;
}

async function createWindow() {
  const url = isDev ? await bootDevServer() : await startProductionServer();
  // The renderer is only ever loaded from this URL — pin the IPC allow-list
  // to that origin so a future renderer compromise (XSS in markdown, agent
  // output rendered as HTML, an added webview) can't reach the IPC surface.
  configureIpcAllowedOrigins([url]);

  win = new BrowserWindow({
    width: MAIN_WINDOW_DEFAULT_WIDTH,
    height: MAIN_WINDOW_DEFAULT_HEIGHT,
    minWidth: MAIN_WINDOW_MIN_WIDTH,
    minHeight: MAIN_WINDOW_MIN_HEIGHT,
    backgroundColor: "#000000",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    trafficLightPosition:
      process.platform === "darwin" ? TRAFFIC_LIGHT_POSITION_DARWIN : undefined,
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  win.once("ready-to-show", () => win?.show());

  // Intercept the configured close-session binding before the default app menu's
  // "Close Window" accelerator closes the BrowserWindow. We forward to the
  // renderer so it can close the focused terminal instead; if nothing claims it,
  // the keystroke is just swallowed.
  win.webContents.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown") return;
    const mod = process.platform === "darwin" ? input.meta : input.control;
    if (mod && !input.alt && input.key.toLowerCase() === "r") {
      event.preventDefault();
      if (input.shift) win?.webContents.reloadIgnoringCache();
      else win?.webContents.reload();
      return;
    }
    const closeBinding = getBinding(app.getPath("userData"), "session.closeWindow");
    if (!matchElectronInput(input, closeBinding)) return;
    event.preventDefault();
    win?.webContents.send(IPC.appCloseIntent);
  });

  // macOS-only: 3-finger swipe (System Settings → Trackpad → More Gestures).
  win.on("swipe", (_e, direction) => {
    win?.webContents.send(IPC.appSwipe, direction);
  });

  win.on("enter-full-screen", () => win?.webContents.send(IPC.appFullScreenChange, true));
  win.on("leave-full-screen", () => win?.webContents.send(IPC.appFullScreenChange, false));
  safeHandle(IPC.appIsFullScreen, () => win?.isFullScreen() ?? false);
  win.webContents.setWindowOpenHandler(({ url }) => {
    void openExternalHttpUrl(url);
    return { action: "deny" };
  });

  // A file dropped outside any drop target would otherwise navigate the
  // window to its file:// URL, blowing away the app shell.
  win.webContents.on("will-navigate", (event, navUrl) => {
    if (navUrl !== url) event.preventDefault();
  });

  await win.loadURL(url);

  if (isDev) {
    win.webContents.openDevTools({ mode: "detach" });
  }
}

protocol.registerSchemesAsPrivileged([
  {
    scheme: "app",
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
  },
]);

const ALLOWED_IMAGE_EXT = new Set(["png", "jpg", "jpeg", "webp", "gif"]);
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const TERMINAL_IMAGE_MAX_BYTES = 20 * 1024 * 1024;
const TERMINAL_IMAGE_MAX_TOTAL_BYTES = 200 * 1024 * 1024;
const TERMINAL_IMAGE_MAX_FILES = 100;
const TERMINAL_IMAGE_MAX_DIMENSION_PX = 10_000;
const TERMINAL_IMAGE_MAX_PIXELS = 25_000_000;
const TERMINAL_IMAGE_MIME_EXT = new Map([
  ["image/png", "png"],
  ["image/jpeg", "jpg"],
  ["image/jpg", "jpg"],
  ["image/webp", "webp"],
  ["image/gif", "gif"],
  ["image/bmp", "bmp"],
]);
const DIRECTORY_GRANTS_FILE = "directory-grants.json";
const DIRECTORY_GRANT_TTL_MS = 15 * 60_000;

function projectImagesDir(): string {
  return path.join(missionControlUserDataDir, "project-images");
}

function terminalImagesDir(): string {
  return path.join(missionControlUserDataDir, "terminal-images");
}

function terminalImageExtension(mimeType: string, name: string): string | null {
  const fromMime = TERMINAL_IMAGE_MIME_EXT.get(mimeType.toLowerCase());
  if (fromMime) return fromMime;
  const ext = path.extname(name).slice(1).toLowerCase();
  return [...TERMINAL_IMAGE_MIME_EXT.values()].includes(ext) ? ext : null;
}

const TERMINAL_IMAGE_NAME_MAX_LEN = 80;

function sanitizedTerminalImageName(name: string): string {
  const parsed = path.parse(path.basename(name || "image"));
  return (
    parsed.name
      .replace(/[^A-Za-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, TERMINAL_IMAGE_NAME_MAX_LEN) || "image"
  );
}

function pruneTerminalImagesDir(dir: string): void {
  try {
    const entries = fs
      .readdirSync(dir)
      .map((name) => {
        const file = path.join(dir, name);
        const stat = fs.statSync(file);
        return stat.isFile() ? { file, size: stat.size, mtimeMs: stat.mtimeMs } : null;
      })
      .filter((entry): entry is { file: string; size: number; mtimeMs: number } => Boolean(entry))
      .sort((a, b) => b.mtimeMs - a.mtimeMs);
    let totalBytes = 0;
    entries.forEach((entry, index) => {
      totalBytes += entry.size;
      if (index < TERMINAL_IMAGE_MAX_FILES && totalBytes <= TERMINAL_IMAGE_MAX_TOTAL_BYTES) return;
      try {
        fs.unlinkSync(entry.file);
      } catch {}
    });
  } catch (err) {
    log.warn("terminal-images.prune-failed", { error: String(err) });
  }
}

function terminalImageSizeError(image: NativeImage): string | null {
  const { width, height } = image.getSize();
  if (width <= 0 || height <= 0) return "invalid image data";
  if (width > TERMINAL_IMAGE_MAX_DIMENSION_PX || height > TERMINAL_IMAGE_MAX_DIMENSION_PX) {
    return `image dimensions exceed ${TERMINAL_IMAGE_MAX_DIMENSION_PX}px`;
  }
  if (width * height > TERMINAL_IMAGE_MAX_PIXELS) {
    return `image exceeds ${TERMINAL_IMAGE_MAX_PIXELS.toLocaleString("en-US")} pixels`;
  }
  return null;
}

function saveTerminalImageBuffer(
  data: Buffer,
  ext: string,
  name = "image",
): { path: string } | { error: string } {
  if (data.byteLength === 0) return { error: "image is empty" };
  if (data.byteLength > TERMINAL_IMAGE_MAX_BYTES) {
    return { error: `image exceeds ${TERMINAL_IMAGE_MAX_BYTES / 1024 / 1024}MB` };
  }
  const dir = terminalImagesDir();
  fs.mkdirSync(dir, { recursive: true });
  const filename = `${Date.now()}-${Math.random().toString(16).slice(2, 10)}-${sanitizedTerminalImageName(name)}.${ext}`;
  const target = path.join(dir, filename);
  fs.writeFileSync(target, data, { mode: 0o600 });
  pruneTerminalImagesDir(dir);
  return { path: target };
}

function saveTerminalNativeImage(
  image: NativeImage,
  name: string,
): { path: string } | { error: string } {
  const sizeError = terminalImageSizeError(image);
  if (sizeError) return { error: sizeError };
  return saveTerminalImageBuffer(image.toPNG(), "png", name);
}

function registerProjectImageProtocol() {
  protocol.handle("app", async (req) => {
    try {
      const url = new URL(req.url);
      if (url.host !== "project-image") return new Response("not found", { status: 404 });
      const filename = path.basename(decodeURIComponent(url.pathname));
      if (!filename || filename.includes("\0")) return new Response("not found", { status: 404 });
      const ext = path.extname(filename).slice(1).toLowerCase();
      if (!ALLOWED_IMAGE_EXT.has(ext)) return new Response("not found", { status: 404 });
      const dirReal = path.resolve(projectImagesDir());
      const abs = path.resolve(dirReal, filename);
      if (abs !== dirReal && !abs.startsWith(dirReal + path.sep)) {
        return new Response("not found", { status: 404 });
      }
      if (!fs.existsSync(abs)) return new Response("not found", { status: 404 });
      return await net.fetch(pathToFileURL(abs).toString());
    } catch (err) {
      return new Response(String(err), { status: 500 });
    }
  });
}

// Tracks paths returned from `dialog:pickImage`. `file:saveProjectImage` will only
// accept a sourcePath that's been issued by us — prevents a compromised renderer
// from copying arbitrary FS paths (e.g. /etc/passwd) into project-images/.
const ALLOWED_PICKED_PATHS = new Set<string>();

function recordPickedDirectoryGrant(dir: string): void {
  const realDir = fs.realpathSync(dir);
  const target = path.join(missionControlUserDataDir, DIRECTORY_GRANTS_FILE);
  let grants: Array<{ path: string; createdAt: number }> = [];
  try {
    const now = Date.now();
    const parsed = JSON.parse(fs.readFileSync(target, "utf8")) as {
      grants?: Array<{ path?: unknown; createdAt?: unknown }>;
    };
    if (Array.isArray(parsed.grants)) {
      grants = parsed.grants.filter(
        (g): g is { path: string; createdAt: number } =>
          typeof g.path === "string" &&
          typeof g.createdAt === "number" &&
          g.createdAt <= now &&
          now - g.createdAt <= DIRECTORY_GRANT_TTL_MS,
      );
    }
  } catch {
    grants = [];
  }
  grants = grants.filter((g) => path.resolve(g.path) !== path.resolve(realDir));
  grants.push({ path: realDir, createdAt: Date.now() });

  fs.mkdirSync(missionControlUserDataDir, { recursive: true });
  const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ grants }, null, 2), "utf8");
  fs.renameSync(tmp, target);
}

safeHandle(IPC.dialogPickImage, async () => {
  if (!win) return null;
  const result = await dialog.showOpenDialog(win, {
    properties: ["openFile"],
    filters: [{ name: "Images", extensions: [...ALLOWED_IMAGE_EXT] }],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  const sourcePath = result.filePaths[0]!;
  const ext = path.extname(sourcePath).slice(1).toLowerCase();
  if (!ALLOWED_IMAGE_EXT.has(ext)) {
    return { error: `Unsupported file type: .${ext}` };
  }
  ALLOWED_PICKED_PATHS.add(sourcePath);
  return { sourcePath, extension: ext };
});

safeHandle(
  IPC.fileSaveProjectImage,
  async (_evt, opts: { projectId: string; sourcePath: string; extension: string }) => {
    const { projectId, sourcePath } = opts;
    const ext = opts.extension.toLowerCase();
    if (!projectId || !/^[A-Za-z0-9_-]+$/.test(projectId)) {
      return { error: "invalid projectId" };
    }
    if (!ALLOWED_PICKED_PATHS.has(sourcePath)) {
      return { error: "source not issued by image picker" };
    }
    if (!ALLOWED_IMAGE_EXT.has(ext)) return { error: `unsupported extension: ${ext}` };
    if (!fs.existsSync(sourcePath)) return { error: "source file not found" };
    const stat = fs.statSync(sourcePath);
    if (stat.size > MAX_IMAGE_BYTES) return { error: `image exceeds ${MAX_IMAGE_BYTES / 1024 / 1024}MB` };

    const dir = projectImagesDir();
    fs.mkdirSync(dir, { recursive: true });
    // Sweep any prior file with a different extension for this project.
    for (const name of fs.readdirSync(dir)) {
      if (name.split(".")[0] === projectId) {
        try {
          fs.unlinkSync(path.join(dir, name));
        } catch {}
      }
    }
    const filename = `${projectId}.${ext}`;
    fs.copyFileSync(sourcePath, path.join(dir, filename));
    ALLOWED_PICKED_PATHS.delete(sourcePath);
    return { filename };
  }
);

safeHandle(IPC.dialogBrowseFolder, async () => {
  if (!win) return null;
  const result = await dialog.showOpenDialog(win, {
    properties: ["openDirectory", "createDirectory"],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  const selected = result.filePaths[0]!;
  try {
    recordPickedDirectoryGrant(selected);
  } catch (err) {
    log.warn("directory-grant.record-failed", { path: selected, error: String(err) });
  }
  return selected;
});

safeHandle(IPC.shellOpenPath, async (_evt, p: string) => {
  const decision = resolveSafeOpenPath(p, loadProjectRoots());
  if (!decision.ok) return decision;
  shell.showItemInFolder(decision.path);
  return { ok: true };
});

safeHandle(IPC.shellOpenExternal, async (_evt, url: string) => {
  return openExternalHttpUrl(url);
});

// Terminal copy/paste is wired through the main process rather than the web
// Clipboard API: navigator.clipboard.readText() is blocked here because
// configurePermissionHandlers() denies the "clipboard-read" permission, and in
// a terminal Ctrl+C/Ctrl+V are control codes (SIGINT / quoted-insert) that
// xterm consumes — so the renderer drives copy/paste off Ctrl+Shift+C/V (and
// Cmd+C/V on macOS) and reaches the native clipboard through these handlers.
const MAX_CLIPBOARD_WRITE_CHARS = 5_000_000;
safeHandle(IPC.clipboardReadText, () => clipboard.readText());
safeHandle(IPC.clipboardWriteText, (_evt, text: string) => {
  const value = typeof text === "string" ? text.slice(0, MAX_CLIPBOARD_WRITE_CHARS) : "";
  clipboard.writeText(value);
  return { ok: true as const };
});
safeHandle(
  IPC.terminalSaveDroppedImage,
  (_evt, input: { name?: unknown; mimeType?: unknown; data?: unknown }) => {
    const name = typeof input?.name === "string" ? input.name : "dropped-image";
    const mimeType = typeof input?.mimeType === "string" ? input.mimeType.split(";")[0]!.trim() : "";
    const ext = terminalImageExtension(mimeType, name);
    if (!ext) return { error: "unsupported image type" };
    const raw = input?.data;
    const data =
      raw instanceof ArrayBuffer
        ? Buffer.from(raw)
        : ArrayBuffer.isView(raw)
          ? Buffer.from(raw.buffer, raw.byteOffset, raw.byteLength)
          : null;
    if (!data) return { error: "invalid image data" };
    if (data.byteLength > TERMINAL_IMAGE_MAX_BYTES) {
      return { error: `image exceeds ${TERMINAL_IMAGE_MAX_BYTES / 1024 / 1024}MB` };
    }
    const image = nativeImage.createFromBuffer(data);
    if (image.isEmpty()) return { error: "invalid image data" };
    return saveTerminalNativeImage(image, name);
  },
);
safeHandle(IPC.terminalSaveClipboardImage, () => {
  const image = clipboard.readImage();
  if (image.isEmpty()) return null;
  return saveTerminalNativeImage(image, "clipboard-image");
});

safeHandle(IPC.appGetRuntimePort, () => runtimePort);
safeHandle(IPC.appGetUserDataDir, () => missionControlUserDataDir);

safeHandle(IPC.appGetUserName, () => {
  try {
    const result = spawnSync("git", ["config", "--global", "user.name"], {
      encoding: "utf8",
      timeout: GIT_CONFIG_PROBE_TIMEOUT_MS,
    });
    const gitName = (result.stdout || "").trim();
    if (gitName) return { source: "git" as const, fullName: gitName, firstName: gitName.split(/\s+/)[0] };
  } catch {}
  const username = os.userInfo().username;
  return { source: "os" as const, fullName: username, firstName: username };
});

safeHandle(IPC.appReload, (event) => {
  const target = BrowserWindow.fromWebContents(event.sender) ?? win;
  if (!target || target.isDestroyed()) {
    return { ok: false as const, error: "window-unavailable" };
  }
  target.reload();
  return { ok: true as const };
});

safeHandle(IPC.cliCheck, (_evt, command: string, opts?: { verifyVersion?: boolean }) => {
  if (!command) return { ok: false, reason: "empty" };
  const env = sanitizedProcessEnv();
  const resolved = resolveAgentCommandOnPath(command, env);
  if (resolved) {
    const requirement = AGENT_CLI_CONFIG_BY_COMMAND[command];
    if (requirement && opts?.verifyVersion) {
      const versionCheck = checkAgentCliVersion(resolved, env, requirement, os.platform());
      if (!versionCheck.ok) {
        const { output: _output, ...safeVersionCheck } = versionCheck;
        return { ...safeVersionCheck, path: resolved };
      }
      return { ok: true, path: resolved, version: versionCheck.version };
    }
    return { ok: true, path: resolved };
  }
  return { ok: false, reason: "not-found" };
});

safeHandle(IPC.remoteVmDeploy, (_evt, input: RemoteVmDeployInput) => {
  return runRemoteVmDeploy(input);
});

safeHandle(IPC.remoteVmStartDeploy, (_evt, input: RemoteVmDeployInput) => {
  const job = startRemoteVmDeployJob(input);
  return { jobId: job.id };
});

safeHandle(IPC.remoteVmListDeployJobs, () => {
  return Array.from(remoteVmDeployJobs.values())
    .map(snapshotRemoteVmDeployJob)
    .sort((a, b) => b.createdAt - a.createdAt);
});

safeHandle(IPC.remoteVmGetDeployLogs, (_evt, jobId: string, afterSeq?: number) => {
  const job = remoteVmDeployJobs.get(jobId);
  if (!job) return { entries: [], nextSeq: 1 };
  const minSeq = Number.isInteger(afterSeq) ? Number(afterSeq) : 0;
  const entries = job.logs.filter((entry) => entry.seq > minSeq);
  return { entries, nextSeq: job.nextSeq };
});

safeHandle(IPC.remoteVmCancelDeploy, (_evt, jobId: string) => {
  return cancelRemoteVmDeployJob(jobId);
});

safeHandle(IPC.remoteVmPause, (_evt, sandboxId: string) => {
  return runRemoteVmLifecycle("pause", sandboxId);
});

safeHandle(IPC.remoteVmResume, (_evt, sandboxId: string) => {
  return runRemoteVmLifecycle("resume", sandboxId);
});

safeHandle(IPC.remoteVmReconcile, (_evt, sandboxId: string): Promise<RemoteVmReconcileResult> => {
  return runRemoteVmReconcile(sandboxId);
});

safeHandle(IPC.remoteVmDestroy, (_evt, sandboxId: string, opts?: { keepRow?: boolean }) => {
  return destroyRemoteVm(sandboxId, opts);
});

registerPtyHandlers(
  ipcMain,
  () => win,
  () => {
    const apiUrl = buildLocalMissionControlApiUrl(runtimePort);
    if (!apiUrl) return null;
    return {
      apiUrl,
      token: getOrCreateApiToken(missionControlUserDataDir),
    };
  },
  () => {
    return runtimePort ? [runtimePort] : [];
  }
);
registerFileHandlers(ipcMain, () => win);

// API bearer token is delivered through IPC only — it must never traverse HTTP
// because the loopback server's same-origin gate doesn't protect against a
// compromised renderer or any other process that can reach the local port.
safeHandle(IPC.settingsGetToken, () => {
  return getOrCreateApiToken(missionControlUserDataDir);
});
safeHandle(IPC.settingsRegenerateToken, () => {
  return regenerateApiToken(missionControlUserDataDir);
});

safeHandle(IPC.debugSessionTerminalLogsList, () => {
  return listSessionTerminalDebugLogs();
});

safeHandle(IPC.debugSessionTerminalLogsClear, () => {
  clearSessionTerminalDebugLogs();
  return { ok: true as const };
});

safeHandle(IPC.debugSessionTerminalLogsRecord, (_evt, input: SessionTerminalDebugLogInput) => {
  return recordSessionTerminalDebugLog({
    ...input,
    source: "renderer",
  });
});

function parseSessionFinishOsNotificationPayload(
  payload: SessionFinishOsNotificationPayload,
): SessionFinishOsNotificationPayload | null {
  const tag = typeof payload?.tag === "string" ? payload.tag : "";
  const title = typeof payload?.title === "string" ? payload.title : "";
  const body = typeof payload?.body === "string" ? payload.body : "";
  const projectId = typeof payload?.projectId === "string" ? payload.projectId : "";
  const taskId = typeof payload?.taskId === "string" ? payload.taskId : "";
  const worktreeId =
    typeof payload?.worktreeId === "string"
      ? payload.worktreeId
      : payload?.worktreeId === null
        ? null
        : null;
  if (!tag || !title || !projectId || !taskId) return null;
  return { tag, title, body, projectId, taskId, worktreeId };
}

safeHandle(IPC.notificationsGetPermission, () => getNativeOsNotificationPermission());

safeHandle(IPC.notificationsShowSessionFinished, (_evt, payload: SessionFinishOsNotificationPayload) => {
  const parsed = parseSessionFinishOsNotificationPayload(payload);
  if (!parsed) return { ok: false as const, error: "invalid-payload" };
  return showSessionFinishOsNotification(win, parsed, () => {
    win?.webContents.send(IPC.notificationsSessionFinishedClick, {
      projectId: parsed.projectId,
      taskId: parsed.taskId,
      worktreeId: parsed.worktreeId,
    });
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on("before-quit", () => {
  (app as any).isQuiting = true;
  killAllPtys();
  disposeAllFileWatchers();
  disposeSandboxManager();
  disposeApiTokenStore();
  disposeAppSettingsStore();
  disposeProjectRootsDb();
  if (serverProcess) serverProcess.kill();
});

app.whenReady().then(() => {
  // pty:spawn validates `cwd` against this DB before letting any binary run,
  // so it must be configured before any window can issue an IPC call.
  configureProjectRootsDb(missionControlUserDataDir);
  configurePermissionHandlers();
  registerProjectImageProtocol();
  registerUpdateManager(ipcMain, () => win, missionControlUserDataDir);
  registerSandboxManager(ipcMain, () => win, missionControlUserDataDir, app.getAppPath(), () =>
    runtimePort
      ? { port: runtimePort, token: getOrCreateApiToken(missionControlUserDataDir) }
      : null,
  );
  return createWindow();
}).catch((err) => {
  console.error("[main] startup failed:", err);
  app.quit();
});
