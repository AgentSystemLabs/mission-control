import type { BrowserWindow, IpcMain } from "electron";
import * as path from "node:path";
import * as os from "node:os";
import * as fs from "node:fs";
import { spawn, execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import log from "electron-log/main";
import { IPC } from "./ipc-channels";
import { safeHandle } from "./ipc-safe-handle";
import {
  appSettingsKV,
  readSandboxSettings,
  writeSandboxSettings,
  type SandboxSettings,
  type SandboxSettingsPatch,
} from "./sandbox-settings";
import {
  DEFAULT_IMAGE_TAG,
  renderSandboxCompose,
  sandboxResources,
} from "./sandbox-compose";
import { allocateSandboxPorts } from "./sandbox-ports";
import { SandboxRegistry, type RegistryDeps } from "./sandbox-registry";
import {
  ensureSandboxPairingToken,
  isSandboxesEnabled,
  listSandboxConfigs,
  persistSandboxPorts,
  readActiveSandboxId,
  readSandboxConfig,
  rotateSandboxPairingToken,
} from "./sandbox-store";
import type { SandboxConfig } from "./sandbox-types";
import { SandboxAgentClient } from "./sandbox-agent-client";

const LOG_TAIL_MAX = 500;
const DOCKER_CHECK_TIMEOUT_MS = 5_000;
const DOCKER_GIT_CLONE_TIMEOUT_MS = 120_000;
const SAFE_CLONE_SLUG = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;
const SSH_USER = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const SSH_HOST = /^[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?$/;
const SSH_REPO_PATH = /^(?:[A-Za-z0-9._~-]+\/)+[A-Za-z0-9._~-]+(?:\.git)?$/;
const SSH_SCP_REMOTE = new RegExp(
  `^(${SSH_USER.source.slice(1, -1)})@(${SSH_HOST.source.slice(1, -1)}):(${SSH_REPO_PATH.source.slice(1, -1)})$`,
);

// State machine + agent-version live in sandbox-types.ts (pure, electron-free) so
// the Phase 2 registry can share them. Re-exported here for existing importers.
export type { SandboxState } from "./sandbox-types";
import type { SandboxState } from "./sandbox-types";
import { EXPECTED_SANDBOX_AGENT_VERSION, isSandboxAgentVersionCurrent } from "./sandbox-types";
export { EXPECTED_SANDBOX_AGENT_VERSION, isSandboxAgentVersionCurrent };

let getWindow: (() => BrowserWindow | null) | null = null;
let userDataDir = "";
// Repo root (dev) / app root (packaged) — used to locate the bundled default-image
// build files (docker/sandbox-base/Dockerfile + the mc-agent build context).
let appRootPath = "";
let initialized = false;
// Supplies the MC API port + token so remote agent spawns can POST hooks back to
// the host via host.docker.internal:<port>. Injected by main.ts (never trusted
// from the renderer).
let getSandboxHookEnv: (() => { port: number; token: string } | null) | null = null;
// remotePty:replay is request/response, but the agent answers with a streamed
// replayResult frame — correlate the pending invoke by ptyId.
const pendingReplays = new Map<string, (r: { data: string; nextSeq: number }) => void>();

const logTail: string[] = [];

// Phase 2: one container + agent connection per sandbox. The registry owns the
// per-sandbox state machine (sandbox-registry.ts); this module supplies the
// Docker/agent side effects and routes IPC.
let registry: SandboxRegistry | null = null;
// Live agent clients keyed by sandbox id (populated on connect, removed on close).
const clients = new Map<string, SandboxAgentClient>();
// The scope the renderer is currently showing. Remote PTY/fs/git route here; null
// = Local (host), in which case the renderer uses the local pty/* surface instead.
let activeSandboxId: string | null = null;
// ptyId → owning sandbox id, so write/resize/kill/replay reach the right agent
// even if the active scope changed since the pty was spawned.
const ptyOwner = new Map<string, string>();
// Host ports currently claimed by running sandboxes — the allocator avoids these
// so concurrent sandboxes never bind the same host port.
const usedHostPorts = new Set<number>();
// All live pairing tokens, redacted from logs.
const activeTokens = new Set<string>();

function redact(text: string): string {
  let out = text;
  for (const token of activeTokens) {
    if (token && token.length >= 8) out = out.split(token).join("***");
  }
  return out;
}

function redactCloneRemote(remote: string): string {
  try {
    const url = new URL(remote);
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return `${url.protocol}//${url.host}${url.pathname}`;
  } catch {
    const scp = remote.match(SSH_SCP_REMOTE);
    return scp ? `${scp[1] === "git" ? "git" : "<user>"}@${scp[2]}:${scp[3]}` : "<unparseable>";
  }
}

function scrubCloneError(stderr: string, remote: string): string {
  return stderr
    .split(remote)
    .join(redactCloneRemote(remote))
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^/@\s]+@/gi, "$1")
    .replace(/([a-z][a-z0-9+.-]*:\/\/[^\s?#'"]+)[?#][^\s'"]+/gi, "$1")
    .trim();
}

export function isSafeSshCloneRemote(remote: string): boolean {
  if (SSH_SCP_REMOTE.test(remote)) return true;
  try {
    const parsed = new URL(remote);
    if (parsed.protocol !== "ssh:") return false;
    const path = parsed.pathname.replace(/^\/+/, "");
    const userOk = parsed.username === "" || SSH_USER.test(parsed.username);
    return !parsed.password && userOk && SSH_HOST.test(parsed.hostname) && SSH_REPO_PATH.test(path);
  } catch {
    return false;
  }
}

export function isLegacyHttpOnlyCloneError(err: unknown): boolean {
  return describe(err).includes("invalid remote: must be an http(s) URL");
}

export function gitAuthCloneFailureHint(
  mode: SandboxConfig["gitAuthMode"],
  err: unknown,
): string | null {
  if (!describe(err).includes("Permission denied (publickey)")) return null;
  if (mode === "none") {
    return "This sandbox is set to no Git authentication. Choose Copy file keys from ~/.ssh or Generate a sandbox key in the sandbox configure panel, then try the clone again.";
  }
  if (mode === "copy-host") {
    return "This sandbox is set to copy file keys from ~/.ssh. Make sure the host has readable private key files; passphrase, keychain, agent-only, and hardware-key identities are not forwarded yet.";
  }
  return "This sandbox generated its own SSH key. Add the generated public key to GitHub as an account key or deploy key before cloning private repositories.";
}

function send(channel: string, payload: unknown): void {
  const win = getWindow?.();
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

// Push a per-sandbox state change to the renderer, tagged with the sandbox id so
// the dropdown / settings can track each one independently.
function emitState(sandboxId: string, next: SandboxState): void {
  log.info("sandbox.state", { event: "sandbox.state", sandboxId, status: next.status });
  send(IPC.sandboxStateChange, { sandboxId, state: next });
}

function pushLog(line: string): void {
  const trimmed = redact(line.replace(/\r?\n$/, ""));
  if (!trimmed) return;
  logTail.push(trimmed);
  if (logTail.length > LOG_TAIL_MAX) logTail.shift();
  // Persist compose output to electron-log too — the in-memory tail dies with
  // the process, so post-hoc "why did start fail" needs the durable copy.
  log.info("sandbox.compose", { event: "sandbox.compose", line: trimmed });
  send(IPC.sandboxLog, trimmed);
}

function kv() {
  return appSettingsKV(userDataDir);
}

function sandboxDir(): string {
  return path.join(userDataDir, "sandbox");
}

type DockerResult = { code: number; stdout: string; stderr: string };

function runDocker(args: string[], opts: { timeoutMs?: number; onLine?: (l: string) => void } = {}): Promise<DockerResult> {
  return new Promise((resolve, reject) => {
    const child = spawn("docker", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = opts.timeoutMs
      ? setTimeout(() => {
          child.kill("SIGTERM");
          reject(new Error(`docker ${args[0]} timed out`));
        }, opts.timeoutMs)
      : null;
    const onChunk = (buf: Buffer, sink: "out" | "err") => {
      const text = buf.toString();
      if (sink === "out") stdout += text;
      else stderr += text;
      if (opts.onLine) for (const l of text.split("\n")) if (l.trim()) opts.onLine(l);
    };
    child.stdout.on("data", (b: Buffer) => onChunk(b, "out"));
    child.stderr.on("data", (b: Buffer) => onChunk(b, "err"));
    child.on("error", (e) => {
      if (timer) clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

async function dockerAvailable(): Promise<boolean> {
  try {
    const r = await runDocker(["info", "--format", "{{.ServerVersion}}"], {
      timeoutMs: DOCKER_CHECK_TIMEOUT_MS,
    });
    return r.code === 0;
  } catch {
    return false;
  }
}


async function imageExists(tag: string): Promise<boolean> {
  try {
    const r = await runDocker(["image", "inspect", tag], { timeoutMs: DOCKER_CHECK_TIMEOUT_MS });
    return r.code === 0;
  } catch {
    return false;
  }
}

// The default image is built locally from the public agent package when present
// (node_modules/@agentsystemlabs/mission-control-agent). During the extraction
// rollout, keep the legacy in-repo mc-agent shape as a fallback so this private
// repo remains buildable until the first npm publish is available.
const DEFAULT_IMAGE_DOCKERFILE_REL = path.join("docker", "sandbox-base", "Dockerfile");
const AGENT_PACKAGE_REL = path.join("node_modules", "@agentsystemlabs", "mission-control-agent");
const DEFAULT_IMAGE_CONTEXT_REL = "mc-agent";
const DEFAULT_IMAGE_BUNDLE_PROBE = path.join("mc-agent", "dist", "mc-agent.cjs");
const PACKAGE_AGENT_BUNDLE_PROBE = path.join("dist", "cli.cjs");

/**
 * Pick the first root that holds BOTH the Dockerfile and the built mc-agent
 * bundle (so we never point `docker build` at a half-staged tree). Pure for
 * tests; the live caller passes the dev/packaged candidate roots + fs.existsSync.
 */
export function resolveDefaultImageBuildIn(
  roots: string[],
  exists: (p: string) => boolean,
): { dockerfile: string; context: string } | null {
  for (const root of roots) {
    if (!root) continue;
    const packageRoot = path.join(root, AGENT_PACKAGE_REL);
    const packageDockerfile = path.join(packageRoot, DEFAULT_IMAGE_DOCKERFILE_REL);
    const packageBundle = path.join(packageRoot, PACKAGE_AGENT_BUNDLE_PROBE);
    if (exists(packageDockerfile) && exists(packageBundle)) {
      return { dockerfile: packageDockerfile, context: packageRoot };
    }
    const dockerfile = path.join(root, DEFAULT_IMAGE_DOCKERFILE_REL);
    const bundle = path.join(root, DEFAULT_IMAGE_BUNDLE_PROBE);
    if (exists(dockerfile) && exists(bundle)) {
      return { dockerfile, context: path.join(root, DEFAULT_IMAGE_CONTEXT_REL) };
    }
  }
  return null;
}

function resolveDefaultImageBuild(): { dockerfile: string; context: string } | null {
  return resolveDefaultImageBuildIn(
    [appRootPath, process.resourcesPath, process.cwd()],
    fs.existsSync,
  );
}

/**
 * Build the bundled default base image (mission-control/sandbox-base:latest).
 * `docker compose up` only PULLS the default image — it never rebuilds it — so a
 * stale local image (older mc-agent baked in) would otherwise survive every
 * restart, which is exactly why "Restart sandbox to update" appeared to no-op.
 * `force` rebuilds unconditionally (the update path); otherwise we build only
 * when the image is missing (first start / US-1.2). Returns ok:true when build
 * files aren't bundled BUT a prebuilt image already exists, so a manually-built
 * image still works.
 */
async function buildDefaultImage(
  force: boolean,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const loc = resolveDefaultImageBuild();
  if (!loc) {
    log.warn("sandbox.image.build.skipped", {
      event: "sandbox.image.build.skipped",
      reason: "default-image-build-files-missing",
    });
    if (await imageExists(DEFAULT_IMAGE_TAG)) return { ok: true };
    return {
      ok: false,
      error:
        "Default sandbox image is missing and its build files aren't bundled. Install @agentsystemlabs/mission-control-agent or build it manually from the agent package.",
    };
  }
  if (!force && (await imageExists(DEFAULT_IMAGE_TAG))) return { ok: true };
  log.info("sandbox.image.build", {
    event: "sandbox.image.build",
    force,
    context: loc.context,
  });
  const startedAt = Date.now();
  try {
    const r = await runDocker(
      ["build", "-f", loc.dockerfile, "-t", DEFAULT_IMAGE_TAG, loc.context],
      { onLine: pushLog },
    );
    if (r.code !== 0) {
      log.error("sandbox.image.build.failed", {
        event: "sandbox.image.build.failed",
        code: r.code,
        stderrTail: redact(r.stderr).slice(-2000),
      });
      return { ok: false, error: `docker build failed (exit ${r.code}). See logs.` };
    }
    log.info("sandbox.image.build.ok", {
      event: "sandbox.image.build.ok",
      durationMs: Date.now() - startedAt,
    });
    return { ok: true };
  } catch (err) {
    log.error("sandbox.image.build.errored", {
      event: "sandbox.image.build.errored",
      err: describe(err),
    });
    return { ok: false, error: `docker build errored: ${describe(err)}` };
  }
}

// ── Per-sandbox compose file (0600; embeds MC_PAIRING_TOKEN in plaintext) ──
function sandboxComposeFile(id: string): string {
  return path.join(sandboxDir(), "sandboxes", id, "docker-compose.yml");
}

function writeSandboxComposeFile(id: string, yaml: string): string {
  const file = sandboxComposeFile(id);
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, yaml, { encoding: "utf8", mode: 0o600 });
  try {
    fs.chmodSync(file, 0o600);
  } catch {
    /* best effort */
  }
  return file;
}

function configFor(id: string): SandboxConfig | null {
  return readSandboxConfig(userDataDir, id);
}

// Bring a sandbox's container up: (re)build the default image if needed, allocate
// host ports (skipping ports other running sandboxes hold), render + write its
// compose, then `docker compose up`. Resolves the host agent port + pairing token.
async function composeUp(
  config: SandboxConfig,
  force: boolean,
): Promise<{ ok: true; hostAgentPort: number; token: string } | { ok: false; error: string }> {
  const token = ensureSandboxPairingToken(userDataDir, config.id);
  activeTokens.add(token);

  if (!config.dockerfilePath) {
    const built = await buildDefaultImage(force);
    if (!built.ok) return built;
  }

  const alloc = allocateSandboxPorts({
    declaredPorts: config.declaredPorts,
    prev: { hostAgentPort: config.hostAgentPort, portMap: config.portMap },
    isFree: (p) => !usedHostPorts.has(p),
  });
  persistSandboxPorts(userDataDir, config.id, alloc.hostAgentPort, alloc.portMap);

  const yaml = renderSandboxCompose({
    id: config.id,
    imageTag: config.imageTag,
    dockerfilePath: config.dockerfilePath,
    buildArgs: config.buildArgs,
    env: config.env,
    hostAgentPort: alloc.hostAgentPort,
    portMap: alloc.portMap,
    pairingToken: token,
  });
  let file: string;
  try {
    file = writeSandboxComposeFile(config.id, yaml);
  } catch (err) {
    return { ok: false, error: `Failed to write compose file: ${describe(err)}` };
  }

  const res = sandboxResources(config.id);
  const args = ["compose", "-p", res.project, "-f", file, "up", "-d"];
  if (config.dockerfilePath) args.push("--build");
  if (force) args.push("--force-recreate");
  try {
    const r = await runDocker(args, { onLine: pushLog });
    if (r.code !== 0) {
      log.error("sandbox.compose.failed", {
        event: "sandbox.compose.failed",
        op: "up",
        sandboxId: config.id,
        code: r.code,
        stderrTail: redact(r.stderr).slice(-2000),
      });
      return { ok: false, error: `docker compose up failed (exit ${r.code}). See logs.` };
    }
  } catch (err) {
    return { ok: false, error: `docker compose up errored: ${describe(err)}` };
  }
  usedHostPorts.add(alloc.hostAgentPort);
  for (const p of Object.values(alloc.portMap)) usedHostPorts.add(p);
  return { ok: true, hostAgentPort: alloc.hostAgentPort, token };
}

async function composeDown(
  config: SandboxConfig,
  destroyVolumes: boolean,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const res = sandboxResources(config.id);
  const file = sandboxComposeFile(config.id);
  if (config.hostAgentPort) usedHostPorts.delete(config.hostAgentPort);
  for (const p of Object.values(config.portMap ?? {})) usedHostPorts.delete(p);
  if (!fs.existsSync(file)) {
    rotateSandboxPairingToken(userDataDir, config.id);
    return { ok: true };
  }
  const args = ["compose", "-p", res.project, "-f", file, "down"];
  if (destroyVolumes) args.push("-v");
  try {
    const r = await runDocker(args, { onLine: pushLog });
    if (r.code !== 0) {
      return { ok: false, error: `docker compose down failed (exit ${r.code}).` };
    }
  } catch (err) {
    return { ok: false, error: `docker compose down errored: ${describe(err)}` };
  }
  // Rotate AFTER teardown — avoids a window where a fresh token mismatches a
  // still-running agent holding the old one.
  rotateSandboxPairingToken(userDataDir, config.id);
  return { ok: true };
}

// Open the agent WS for a running sandbox. Streams are keyed by globally-unique
// ptyId / watchId, so they forward unconditionally — the renderer routes to the
// right pane (a background sandbox's output still reaches its handler).
function connectAgent(
  config: SandboxConfig,
  agentUrl: string,
  token: string,
  cb: {
    onReady: (v: string, a: Record<string, string | null>) => void;
    onClose: () => void;
    onError?: (err: Error) => void;
  },
): { close: () => void } {
  activeTokens.add(token);
  const id = config.id;
  log.info("sandbox.ws.connect", { event: "sandbox.ws.connect", sandboxId: id, kind: config.kind });
  const client = new SandboxAgentClient(agentUrl, token, {
    onReady: (version, agents) => {
      cb.onReady(version, agents);
      if (isSandboxAgentVersionCurrent(version)) {
        void provisionGitAuthFor(id).catch((err) =>
          log.warn("sandbox.git-auth.fail", {
            event: "sandbox.git-auth.fail",
            sandboxId: id,
            err: describe(err),
          }),
        );
        void ensureAgentCredsProvisionedFor(id).catch((err) =>
          log.warn("sandbox.agent-creds.fail", {
            event: "sandbox.agent-creds.fail",
            sandboxId: id,
            err: describe(err),
          }),
        );
      }
    },
    onClose: () => {
      if (clients.get(id) === client) clients.delete(id);
      cb.onClose();
    },
    onError: (err) => {
      cb.onError?.(err);
      log.warn("sandbox.ws.error", { event: "sandbox.ws.error", sandboxId: id, err: describe(err) });
    },
    onSpawned: (ptyId) => send(IPC.remotePtySpawned, { ptyId }),
    onSpawnError: (ptyId, code, message) => send(IPC.remotePtySpawnError, { ptyId, code, message }),
    onOutput: (ptyId, seq, data) => send(IPC.remotePtyData, { ptyId, data, seq }),
    onExit: (ptyId, exitCode, signal) =>
      send(IPC.remotePtyExit, { ptyId, exitCode: exitCode ?? 0, signal }),
    onReplayResult: (ptyId, data, nextSeq) => {
      const resolve = pendingReplays.get(ptyId);
      if (resolve) {
        pendingReplays.delete(ptyId);
        resolve({ data, nextSeq });
      }
    },
    onFsChange: (watchId, p, mtimeMs) => send(IPC.remoteFsChange, { watchId, path: p, mtimeMs }),
  }, { tlsCa: config.remoteAgentCa ?? undefined });
  clients.set(id, client);
  return {
    close: () => {
      if (clients.get(id) === client) clients.delete(id);
      client.close();
    },
  };
}

function getRegistry(): SandboxRegistry {
  if (registry) return registry;
  const deps: RegistryDeps = { dockerAvailable, composeUp, composeDown, connectAgent, emitState };
  registry = new SandboxRegistry(deps);
  return registry;
}

function activeClient(): SandboxAgentClient | null {
  return activeSandboxId ? clients.get(activeSandboxId) ?? null : null;
}

function ownerClient(ptyId: string): SandboxAgentClient | null {
  const owner = ptyOwner.get(ptyId);
  return owner ? clients.get(owner) ?? null : null;
}

// Ensure the active sandbox is started, then wait (briefly) for its agent WS to
// connect — a freshly-started container needs a few seconds before mc-agent is
// listening, during which the registry is reconnecting. Returns null on timeout.
const AGENT_CONNECT_WAIT_MS = 12_000;
async function waitForActiveClient(timeoutMs = AGENT_CONNECT_WAIT_MS): Promise<SandboxAgentClient | null> {
  const id = activeSandboxId;
  if (!id) return null;
  await ensureSandboxStarted(id);
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (activeSandboxId !== id) return null; // scope changed out from under us
    const c = clients.get(id);
    if (c?.isOpen) return c;
    await new Promise((r) => setTimeout(r, 150));
  }
  const c = clients.get(id);
  return c?.isOpen ? c : null;
}

/** "Keep all running": local Docker sandboxes are adopted via compose; remote
 *  sandboxes reconnect to their configured agent URL. */
async function reconcile(): Promise<void> {
  const configs = listSandboxConfigs(userDataDir);
  if (!configs.some((c) => c.kind === "remote-vm") && !(await dockerAvailable())) return;
  await getRegistry().reconcile(configs);
}

/** Ensure a single sandbox is started (used when the renderer selects a scope). */
async function ensureSandboxStarted(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const config = configFor(id);
  if (!config) return { ok: false, error: "unknown sandbox" };
  const state = getRegistry().getState(id);
  if (state && (state.status === "running" || state.status === "connected" || state.status === "starting")) {
    return { ok: true };
  }
  return getRegistry().start(config);
}

async function provisionGitAuthFor(
  id: string,
  options: { requireConfigured?: boolean } = {},
): Promise<{ publicKey?: string }> {
  const client = clients.get(id);
  if (!client?.isOpen) {
    if (options.requireConfigured) throw new Error("sandbox is not connected");
    return {};
  }
  const config = configFor(id);
  const mode = config?.gitAuthMode ?? "none";
  if (mode === "none") {
    if (options.requireConfigured) {
      throw new Error(
        "This sandbox is set to no Git authentication. Choose Copy file keys from ~/.ssh or Generate a sandbox key in the sandbox configure panel.",
      );
    }
    return {};
  }
  try {
    if (mode === "copy-host") {
      const files = readHostSshFiles();
      if (!files.length) {
        const message =
          "No readable SSH key files were found in ~/.ssh. Copy-host mode only supports file-based keys; use Generate a sandbox key or add a readable private key file.";
        if (options.requireConfigured) throw new Error(message);
        log.warn("sandbox.git-auth.empty", { event: "sandbox.git-auth.empty", sandboxId: id, mode });
        return {};
      }
      if (files.length) await client.rpc("ssh.setup", { mode: "copy", files });
      log.info("sandbox.git-auth", { event: "sandbox.git-auth", sandboxId: id, mode, files: files.length });
      return {};
    }
    if (mode === "generate") {
      const r = (await client.rpc("ssh.setup", { mode: "generate" })) as { publicKey?: string };
      log.info("sandbox.git-auth", { event: "sandbox.git-auth", sandboxId: id, mode });
      return { publicKey: r?.publicKey };
    }
  } catch (err) {
    log.warn("sandbox.git-auth.fail", {
      event: "sandbox.git-auth.fail",
      sandboxId: id,
      mode,
      err: describe(err),
    });
    if (options.requireConfigured) {
      throw new Error(`Failed to provision Git authentication for this sandbox: ${describe(err)}`);
    }
  }
  return {};
}

/** Push the host's AI-CLI logins to a connected sandbox when copyAgentCreds is on. */
async function provisionAgentCredsFor(
  id: string,
  options: { requireConfigured?: boolean; requireTool?: AgentCredItem["tool"] } = {},
): Promise<{ wrote: number }> {
  const client = clients.get(id);
  if (!client?.isOpen) {
    if (options.requireConfigured) throw new Error("sandbox is not connected");
    return { wrote: 0 };
  }
  const config = configFor(id);
  if (!config?.copyAgentCreds) {
    if (options.requireConfigured) {
      throw new Error("This sandbox is not set to copy AI tool credentials.");
    }
    return { wrote: 0 };
  }
  const items = readHostAgentCreds();
  if (!items.length) {
    const message =
      "No AI tool credentials were found on the host. Log in locally with claude / codex / cursor-agent / opencode first.";
    if (options.requireConfigured) throw new Error(message);
    log.warn("sandbox.agent-creds.empty", { event: "sandbox.agent-creds.empty", sandboxId: id });
    return { wrote: 0 };
  }
  if (
    options.requireTool &&
    !items.some((item) => item.tool === options.requireTool && item.kind === "credentials")
  ) {
    const message = `No ${credToolLabel(options.requireTool)} credentials were found on the host. Log in locally first.`;
    if (options.requireConfigured) throw new Error(message);
    log.warn("sandbox.agent-creds.empty", {
      event: "sandbox.agent-creds.empty",
      sandboxId: id,
      tool: options.requireTool,
    });
    return { wrote: 0 };
  }
  try {
    const r = (await client.rpc("creds.setup", { items })) as {
      wrote?: number;
      written?: Array<{ tool?: unknown; kind?: unknown }>;
    };
    const wrote = r?.wrote ?? 0;
    const wroteRequiredCredential = r.written
      ? r.written.some((item) => item.tool === options.requireTool && item.kind === "credentials")
      : wrote > 0;
    if (options.requireConfigured && options.requireTool && !wroteRequiredCredential) {
      throw new Error(`Sandbox agent did not write ${credToolLabel(options.requireTool)} credentials.`);
    }
    // Log counts + tool names only — never the credential bytes.
    log.info("sandbox.agent-creds", {
      event: "sandbox.agent-creds",
      sandboxId: id,
      sent: items.length,
      wrote,
      tools: [...new Set(items.map((i) => i.tool))],
    });
    return { wrote };
  } catch (err) {
    log.warn("sandbox.agent-creds.fail", {
      event: "sandbox.agent-creds.fail",
      sandboxId: id,
      err: describe(err),
    });
    if (options.requireConfigured) {
      throw new Error(`Failed to copy AI tool credentials to this sandbox: ${describe(err)}`);
    }
    return { wrote: 0 };
  }
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function requiredCredToolForAgent(agent: string | undefined): AgentCredItem["tool"] | null {
  if (agent === "claude-code") return "claude";
  if (agent === "codex") return "codex";
  if (agent === "cursor-cli") return "cursor";
  if (agent === "opencode") return "opencode";
  return null;
}

function credToolLabel(tool: AgentCredItem["tool"]): string {
  if (tool === "claude") return "Claude Code";
  if (tool === "cursor") return "Cursor";
  return tool[0]!.toUpperCase() + tool.slice(1);
}

async function ensureAgentCredsProvisionedFor(
  id: string,
  options: { requireConfigured?: boolean; requireTool?: AgentCredItem["tool"] } = {},
): Promise<{ wrote: number }> {
  return provisionAgentCredsFor(id, options);
}

async function cloneViaDockerExec(
  container: string,
  remote: string,
  slug: string,
  branch?: string,
): Promise<{ slug: string; path: string }> {
  if (!SAFE_CLONE_SLUG.test(slug)) throw new Error("invalid slug");
  if (!isSafeSshCloneRemote(remote)) {
    throw new Error("invalid remote: must be an SSH remote");
  }

  log.warn("sandbox.git.clone.compat", {
    event: "sandbox.git.clone.compat",
    reason: "legacy-agent-http-only-validator",
    slug,
    remote: redactCloneRemote(remote),
  });
  const gitArgs = ["clone"];
  if (branch) gitArgs.push("-b", branch);
  gitArgs.push("--", remote, slug);
  const r = await runDocker(
    [
      "exec",
      "--user",
      "workspace",
      "--workdir",
      "/workspace",
      "-e",
      "HOME=/home/workspace",
      "-e",
      "GIT_ALLOW_PROTOCOL=http:https:ssh",
      "-e",
      "GIT_PROTOCOL_FROM_USER=0",
      "-e",
      "GIT_TERMINAL_PROMPT=0",
      "-e",
      "GIT_SSH_COMMAND=ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new",
      container,
      "git",
      ...gitArgs,
    ],
    { timeoutMs: DOCKER_GIT_CLONE_TIMEOUT_MS },
  );
  if (r.code !== 0) {
    throw new Error(`git clone failed: ${scrubCloneError(r.stderr, remote) || `exit ${r.code}`}`);
  }
  return { slug, path: `/workspace/${slug}` };
}

/** Renderer-safe view of the legacy global settings: never expose tokens or secret-like build arg values. */
function publicSettings(
  s: SandboxSettings,
): Omit<SandboxSettings, "pairingToken" | "buildArgs"> & {
  buildArgKeys: string[];
  hasBuildArgs: boolean;
  hasPairingToken: boolean;
} {
  const { pairingToken, buildArgs, ...rest } = s;
  return {
    ...rest,
    buildArgKeys: Object.keys(buildArgs).sort(),
    hasBuildArgs: Object.keys(buildArgs).length > 0,
    hasPairingToken: !!pairingToken,
  };
}

function buildDiagnostics(): string {
  const lines: string[] = ["Mission Control sandbox diagnostics"];
  lines.push(`active sandbox: ${activeSandboxId ?? "(none / Local)"}`);
  for (const { sandboxId, state } of getRegistry().allStates()) {
    const detail =
      state.status === "connected" || state.status === "update-required"
        ? ` (agent ${state.version})`
        : "";
    lines.push(`- ${sandboxId}: ${state.status}${detail}`);
  }
  lines.push(`default image: ${DEFAULT_IMAGE_TAG}`);
  lines.push("");
  lines.push(`last ${Math.min(logTail.length, 50)} log lines:`);
  lines.push(...logTail.slice(-50));
  return lines.join("\n");
}

const MAX_SSH_FILE_BYTES = 64 * 1024;
const SAFE_SSH_FILENAME = /^[A-Za-z0-9._-]+$/;
const SSH_PRIVATE_KEY_FILE = /^id_(rsa|ecdsa|ed25519)$/;
const SSH_PUBLIC_KEY_FILE = /^id_(rsa|ecdsa|ed25519)\.pub$/;
const SSH_KNOWN_HOSTS_FILE = /^known_hosts(?:\.old)?$/;

function isCopyableSshFile(name: string, content: string): boolean {
  if (SSH_KNOWN_HOSTS_FILE.test(name)) return true;
  if (SSH_PUBLIC_KEY_FILE.test(name)) return content.trimStart().startsWith("ssh-");
  if (!SSH_PRIVATE_KEY_FILE.test(name)) return false;
  return /^-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/m.test(content);
}

/** Read the host's ~/.ssh key material to copy into a sandbox (copy-host mode). */
function readHostSshFiles(): Array<{ name: string; content: string }> {
  const dir = path.join(os.homedir(), ".ssh");
  const out: Array<{ name: string; content: string }> = [];
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of names) {
    if (!SAFE_SSH_FILENAME.test(name)) continue;
    const full = path.join(dir, name);
    try {
      const st = fs.lstatSync(full);
      if (!st.isFile() || st.size > MAX_SSH_FILE_BYTES) continue;
      const content = fs.readFileSync(full, "utf8");
      if (isCopyableSshFile(name, content)) out.push({ name, content });
    } catch {
      /* skip unreadable entries */
    }
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// AI-CLI credential copy (US: "Copy my AI tool credentials"). Reads the host's
// local logins and labels each item { tool, kind, content }; the agent owns
// where it lands on the VM (see mc-agent/src/creds-rpc.ts). Mirrors the SSH copy.
// ─────────────────────────────────────────────────────────────────────────────

type AgentCredItem = {
  tool: "claude" | "codex" | "cursor" | "opencode";
  kind: "credentials" | "state";
  content: string;
};

const MAX_CRED_BYTES = 256 * 1024;

// Only the global auth/onboarding keys of ~/.claude.json — deliberately NOT
// `projects` (host paths), `mcpServers`, or history. Just enough for the VM to
// recognize the account and skip first-run onboarding.
const CLAUDE_STATE_KEYS = [
  "oauthAccount",
  "userID",
  "hasCompletedOnboarding",
  "lastOnboardingVersion",
  "firstStartTime",
  "installMethod",
  "subscriptionNoticeCount",
  "hasAvailableSubscription",
] as const;

/** Read a macOS Keychain generic-password item's secret, or null if absent. */
function readKeychainSecret(service: string): string | null {
  if (process.platform !== "darwin") return null;
  try {
    const out = execFileSync("security", ["find-generic-password", "-s", service, "-w"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const trimmed = out.replace(/\r?\n$/, "");
    return trimmed.length ? trimmed : null;
  } catch {
    return null; // item missing or access denied — skip silently
  }
}

/** Read a small text file under $HOME, capped, or null if absent/oversized. */
function readHostCredFile(...segments: string[]): string | null {
  const full = path.join(os.homedir(), ...segments);
  try {
    const st = fs.lstatSync(full);
    if (!st.isFile() || st.size > MAX_CRED_BYTES) return null;
    const content = fs.readFileSync(full, "utf8");
    return content.length ? content : null;
  } catch {
    return null;
  }
}

/** Trim ~/.claude.json down to the allow-listed auth/onboarding keys (JSON). */
function readClaudeState(): string | null {
  const raw = readHostCredFile(".claude.json");
  if (!raw) return null;
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
  const trimmed: Record<string, unknown> = {};
  for (const key of CLAUDE_STATE_KEYS) {
    if (parsed[key] !== undefined) trimmed[key] = parsed[key];
  }
  return Object.keys(trimmed).length ? JSON.stringify(trimmed) : null;
}

/** Read the host's AI-CLI logins to push into a sandbox (copyAgentCreds mode). */
export function readHostAgentCreds(): AgentCredItem[] {
  const out: AgentCredItem[] = [];
  const push = (item: AgentCredItem | null): void => {
    if (item && item.content && Buffer.byteLength(item.content, "utf8") <= MAX_CRED_BYTES) out.push(item);
  };

  // Claude Code: token in the macOS Keychain, or ~/.claude/.credentials.json on
  // a Linux host. Plus a trimmed copy of the onboarding/account state.
  const claudeCred = readKeychainSecret("Claude Code-credentials") ?? readHostCredFile(".claude", ".credentials.json");
  if (claudeCred) push({ tool: "claude", kind: "credentials", content: claudeCred });
  const claudeState = readClaudeState();
  if (claudeState) push({ tool: "claude", kind: "state", content: claudeState });

  // Codex: plain file at ~/.codex/auth.json on every platform.
  const codexCred = readHostCredFile(".codex", "auth.json");
  if (codexCred) push({ tool: "codex", kind: "credentials", content: codexCred });

  // Cursor: access + refresh tokens live in the macOS Keychain; the VM reads a
  // file-based auth.json. On a Linux host, copy that file directly.
  const cursorAccess = readKeychainSecret("cursor-access-token");
  const cursorRefresh = readKeychainSecret("cursor-refresh-token");
  if (cursorAccess) {
    push({
      tool: "cursor",
      kind: "credentials",
      content: JSON.stringify({ accessToken: cursorAccess, refreshToken: cursorRefresh ?? cursorAccess }),
    });
  } else {
    const cursorFile = readHostCredFile(".config", "cursor-agent", "auth.json");
    if (cursorFile) push({ tool: "cursor", kind: "credentials", content: cursorFile });
  }

  // OpenCode: plain file at ~/.local/share/opencode/auth.json.
  const opencodeCred = readHostCredFile(".local", "share", "opencode", "auth.json");
  if (opencodeCred) push({ tool: "opencode", kind: "credentials", content: opencodeCred });

  return out;
}

/** Read a host project's origin remote so a sandbox clone can prefill the URL. */
function sanitizeDetectedRemote(remote: string): string | null {
  try {
    const parsed = new URL(remote);
    if (parsed.username || parsed.password || parsed.search || parsed.hash) return null;
  } catch {
    // SCP-style SSH remotes are checked below.
  }
  const scp = remote.match(SSH_SCP_REMOTE);
  if (scp && scp[1] !== "git") return null;
  return remote;
}

function detectGitRemote(projectPath: string): Promise<string | null> {
  return new Promise((resolve) => {
    const child = spawn("git", ["-C", projectPath, "remote", "get-url", "origin"], {
      stdio: ["ignore", "pipe", "ignore"],
    });
    let out = "";
    child.stdout.on("data", (d: Buffer) => (out += d));
    child.on("error", () => resolve(null));
    child.on("close", (code) => resolve(code === 0 && out.trim() ? sanitizeDetectedRemote(out.trim()) : null));
  });
}

type RemotePtySpawnOpts = {
  taskId: string;
  cwd: string;
  command: string;
  agent?: string;
  shell?: boolean;
  home?: boolean;
  args?: string[];
  cols?: number;
  rows?: number;
  dangerouslySkipPermissions?: boolean;
  missionControlTheme?: "dark" | "light";
};

export function registerSandboxManager(
  ipcMain: IpcMain,
  windowAccessor: () => BrowserWindow | null,
  appUserDataDir: string,
  appRoot: string,
  hookEnvAccessor?: () => { port: number; token: string } | null,
): void {
  if (initialized) return;
  initialized = true;
  getWindow = windowAccessor;
  userDataDir = appUserDataDir;
  appRootPath = appRoot;
  getSandboxHookEnv = hookEnvAccessor ?? null;
  // Restore the persisted active scope so runtime routing is correct from launch.
  activeSandboxId = isSandboxesEnabled(userDataDir) ? readActiveSandboxId(userDataDir) : null;

  // Adopt any sandboxes already running (keep-all-running) on launch.
  void reconcile();

  const resolveId = (id?: string | null): string | null => id ?? activeSandboxId;

  // ── Legacy global settings (vestigial under multi-sandbox; kept so the
  //    existing Settings page config fields don't crash). Phase 4 restructures. ──
  safeHandle(IPC.sandboxGetSettings, () => publicSettings(readSandboxSettings(kv())), ipcMain);
  safeHandle(
    IPC.sandboxUpdateSettings,
    (_e, patch: SandboxSettingsPatch) => publicSettings(writeSandboxSettings(kv(), patch ?? {})),
    ipcMain,
  );
  safeHandle(
    IPC.sandboxValidateDockerfile,
    (_e, p: string) => {
      try {
        const st = fs.statSync(p);
        return { ok: true as const, exists: true, isDirectory: st.isDirectory() };
      } catch {
        return { ok: true as const, exists: false, isDirectory: false };
      }
    },
    ipcMain,
  );
  safeHandle(IPC.sandboxDetectRemote, (_e, projectPath: string) => detectGitRemote(projectPath), ipcMain);
  safeHandle(IPC.sandboxRevealApiKey, (_e, sandboxId: string) => {
    const config = configFor(sandboxId);
    const apiKey = config?.kind === "remote-vm" ? config.pairingToken?.trim() : "";
    if (!apiKey) return { ok: false as const, error: "No saved API key" };
    return { ok: true as const, apiKey };
  }, ipcMain);

  // ── Per-sandbox lifecycle (sandboxId required; falls back to the active scope). ──
  safeHandle(
    IPC.sandboxGetState,
    (_e, sandboxId?: string) => {
      const id = resolveId(sandboxId);
      if (!id) return { status: "disabled" } as const;
      return getRegistry().getState(id) ?? ({ status: "stopped", dockerAvailable: true } as const);
    },
    ipcMain,
  );
  safeHandle(
    IPC.sandboxUp,
    (_e, sandboxId?: string) => {
      const id = resolveId(sandboxId);
      if (!id) return Promise.resolve({ ok: false as const, error: "no sandbox selected" });
      const config = configFor(id);
      return config ? getRegistry().start(config) : Promise.resolve({ ok: false as const, error: "unknown sandbox" });
    },
    ipcMain,
  );
  safeHandle(
    IPC.sandboxRebuild,
    (_e, sandboxId?: string) => {
      const id = resolveId(sandboxId);
      if (!id) return Promise.resolve({ ok: false as const, error: "no sandbox selected" });
      const config = configFor(id);
      return config ? getRegistry().rebuild(config) : Promise.resolve({ ok: false as const, error: "unknown sandbox" });
    },
    ipcMain,
  );
  safeHandle(
    IPC.sandboxDown,
    (_e, sandboxId?: string) => {
      const id = resolveId(sandboxId);
      return id ? getRegistry().stop(id) : Promise.resolve({ ok: false as const, error: "no sandbox selected" });
    },
    ipcMain,
  );
  safeHandle(
    IPC.sandboxDestroy,
    (_e, sandboxId: string) => {
      const config = configFor(sandboxId);
      if (!config) return Promise.resolve({ ok: true as const });
      return getRegistry().destroy(config);
    },
    ipcMain,
  );
  safeHandle(
    IPC.sandboxSetActive,
    async (_e, sandboxId: string | null) => {
      activeSandboxId = sandboxId;
      if (sandboxId) await ensureSandboxStarted(sandboxId);
      return { ok: true as const };
    },
    ipcMain,
  );
  safeHandle(
    IPC.sandboxConnect,
    async (_e, sandboxId?: string) => {
      const id = resolveId(sandboxId);
      if (!id) return { ok: true as const };
      const state = getRegistry().getState(id);
      if (state?.status === "running" || state?.status === "error") {
        const config = configFor(id);
        return config ? getRegistry().retryConnect(config) : { ok: false as const, error: "unknown sandbox" };
      }
      void ensureSandboxStarted(id);
      return { ok: true as const };
    },
    ipcMain,
  );
  safeHandle(
    IPC.sandboxDisconnect,
    (_e, sandboxId?: string) => {
      const id = resolveId(sandboxId);
      if (id) void getRegistry().stop(id);
      return { ok: true as const };
    },
    ipcMain,
  );
  safeHandle(
    IPC.sandboxStatus,
    async () => {
      await reconcile();
      return { dockerAvailable: await dockerAvailable(), states: getRegistry().allStates() };
    },
    ipcMain,
  );
  safeHandle(IPC.sandboxDiagnostics, () => buildDiagnostics(), ipcMain);
  safeHandle(
    IPC.sandboxSetupGitAuth,
    (_e, sandboxId?: string) => {
      const id = resolveId(sandboxId);
      return id ? provisionGitAuthFor(id, { requireConfigured: true }) : Promise.resolve({});
    },
    ipcMain,
  );

  // ── Remote PTY (active sandbox; ptyId routes write/resize/kill/replay) ──
  safeHandle(
    IPC.remotePtySpawn,
    async (_e, opts: RemotePtySpawnOpts) => {
      const id = activeSandboxId;
      const client = await waitForActiveClient();
      if (!client) throw new Error("sandbox is not connected");
      const config = id ? configFor(id) : null;
      const requiredTool = requiredCredToolForAgent(opts.agent);
      if (id && config?.copyAgentCreds && requiredTool) {
        await ensureAgentCredsProvisionedFor(id, { requireConfigured: true, requireTool: requiredTool });
        if (activeSandboxId !== id || clients.get(id) !== client) {
          throw new Error("Active sandbox changed before the terminal started.");
        }
      }
      const ptyId = `rpty-${randomUUID()}`;
      if (id) ptyOwner.set(ptyId, id);
      const hook = getSandboxHookEnv?.() ?? null;
      client.spawn({
        ptyId,
        taskId: opts.taskId,
        cwd: opts.cwd,
        command: opts.command,
        agent: opts.agent,
        shell: opts.shell,
        home: opts.home,
        args: opts.args,
        cols: opts.cols,
        rows: opts.rows,
        dangerouslySkipPermissions: opts.dangerouslySkipPermissions,
        missionControlTheme: opts.missionControlTheme,
        mcEnv: hook ? { port: hook.port, token: hook.token } : undefined,
      });
      return { ptyId };
    },
    ipcMain,
  );
  safeHandle(IPC.remotePtyWrite, (_e, ptyId: string, data: string) => {
    const c = ownerClient(ptyId) ?? activeClient();
    if (!c) return false;
    c.write(ptyId, data);
    return true;
  }, ipcMain);
  safeHandle(IPC.remotePtyResize, (_e, ptyId: string, cols: number, rows: number) => {
    const c = ownerClient(ptyId) ?? activeClient();
    if (!c) return false;
    c.resize(ptyId, cols, rows);
    return true;
  }, ipcMain);
  safeHandle(IPC.remotePtyKill, (_e, ptyId: string) => {
    const c = ownerClient(ptyId) ?? activeClient();
    ptyOwner.delete(ptyId);
    if (!c) return false;
    c.kill(ptyId);
    return true;
  }, ipcMain);
  safeHandle(IPC.remotePtyReplay, (_e, ptyId: string) => {
    const current = ownerClient(ptyId) ?? activeClient();
    if (!current) return { data: "", nextSeq: 0 };
    return new Promise<{ data: string; nextSeq: number }>((resolve) => {
      const prior = pendingReplays.get(ptyId);
      if (prior) {
        pendingReplays.delete(ptyId);
        prior({ data: "", nextSeq: 0 });
      }
      const timer = setTimeout(() => {
        pendingReplays.delete(ptyId);
        resolve({ data: "", nextSeq: 0 });
      }, 5_000);
      pendingReplays.set(ptyId, (r) => {
        clearTimeout(timer);
        resolve(r);
      });
      current.replay(ptyId);
    });
  }, ipcMain);

  // ── Remote fs/git RPC (routed to the active sandbox's agent) ──
  const activeRpc = async (
    method: "fs.list" | "fs.read" | "fs.write" | "fs.watch" | "fs.unwatch",
    params: Record<string, unknown>,
  ): Promise<unknown> => {
    const client = await waitForActiveClient();
    if (!client) return { ok: false, error: "not-connected" };
    return client.rpc(method, params);
  };
  safeHandle(IPC.remoteFsList, (_e, p: string) => activeRpc("fs.list", { path: p }), ipcMain);
  safeHandle(IPC.remoteFsRead, (_e, p: string) => activeRpc("fs.read", { path: p }), ipcMain);
  safeHandle(
    IPC.remoteFsWrite,
    (_e, p: string, content: string, expectedMtimeMs: number | null) =>
      activeRpc("fs.write", { path: p, content, expectedMtimeMs }),
    ipcMain,
  );
  safeHandle(IPC.remoteFsWatch, (_e, p: string) => activeRpc("fs.watch", { path: p }), ipcMain);
  safeHandle(IPC.remoteFsUnwatch, (_e, watchId: string) => activeRpc("fs.unwatch", { watchId }), ipcMain);

  const activeGitRpc = async (
    method: "git.status" | "git.diff" | "git.clone",
    params: Record<string, unknown>,
  ): Promise<unknown> => {
    const client = await waitForActiveClient();
    if (!client) throw new Error("sandbox is not connected");
    return client.rpc(method, params, {
      timeoutMs: method === "git.clone" ? DOCKER_GIT_CLONE_TIMEOUT_MS : undefined,
    });
  };
  safeHandle(IPC.remoteGitStatus, (_e, repo: string) => activeGitRpc("git.status", { repo }), ipcMain);
  safeHandle(
    IPC.remoteGitDiff,
    (_e, repo: string, file: string, staged: boolean) => activeGitRpc("git.diff", { repo, file, staged }),
    ipcMain,
  );
  safeHandle(
    IPC.remoteGitClone,
    async (_e, remote: string, slug: string, branch?: string) => {
      const id = activeSandboxId;
      if (id && isSafeSshCloneRemote(remote)) {
        await provisionGitAuthFor(id, { requireConfigured: true });
      }
      const cloneParams = branch ? { remote, slug, branch } : { remote, slug };
      try {
        return await activeGitRpc("git.clone", cloneParams);
      } catch (err) {
        const cfg = id ? configFor(id) : null;
        if (id && cfg?.kind === "local-docker" && isSafeSshCloneRemote(remote) && isLegacyHttpOnlyCloneError(err)) {
          return cloneViaDockerExec(sandboxResources(id).container, remote, slug, branch);
        }
        if (id && isSafeSshCloneRemote(remote)) {
          const hint = gitAuthCloneFailureHint(cfg?.gitAuthMode ?? "none", err);
          if (hint) throw new Error(`${describe(err)}\n\n${hint}`);
        }
        throw err;
      }
    },
    ipcMain,
  );
}

export function disposeSandboxManager(): void {
  registry?.disposeAll();
  for (const c of clients.values()) c.close();
  clients.clear();
}
