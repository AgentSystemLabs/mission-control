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
import { SandboxRegistry, type RegistryDeps } from "./sandbox-registry";
import {
  isSandboxesEnabled,
  listSandboxConfigs,
  readActiveSandboxId,
  readSandboxConfig,
} from "./sandbox-store";
import type { SandboxConfig } from "./sandbox-types";
import { SandboxAgentClient } from "./sandbox-agent-client";
import { buildSandboxHookRelayUrl } from "./pty-hook-env";

const GIT_CLONE_TIMEOUT_MS = 120_000;
const REMOTE_PTY_REPLAY_TIMEOUT_MS = 5_000;
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
let initialized = false;
// Supplies the MC API port + token so remote agent spawns can POST hooks back to
// the host. Injected by main.ts (never trusted from the renderer).
let getSandboxHookEnv: (() => { port: number; token: string } | null) | null = null;

/** Relay a sandbox agent hook frame to the host Mission Control API. */
function forwardSandboxHook(
  slug: string,
  taskId: string,
  hookEvent: string | undefined,
  body: string,
): void {
  const hook = getSandboxHookEnv?.() ?? null;
  if (!hook) return;
  const url = buildSandboxHookRelayUrl(hook.port, slug, taskId, hookEvent);
  if (!url) return;
  void fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${hook.token}`,
      "X-Mission-Control-Runtime": "electron-sandbox-relay",
    },
    body: body || "{}",
  }).catch((err) => {
    log.warn("sandbox.hook.relay.fail", {
      event: "sandbox.hook.relay.fail",
      slug,
      taskId,
      hookEvent: hookEvent ?? null,
      err: describe(err),
    });
  });
}
// remotePty:replay is request/response, but the agent answers with a streamed
// replayResult frame — correlate the pending invoke by ptyId.
const pendingReplays = new Map<string, (r: { data: string; nextSeq: number }) => void>();

// Phase 2: one remote agent connection per sandbox. The registry owns the
// per-sandbox state machine (sandbox-registry.ts); this module supplies the
// agent side effects and routes IPC.
let registry: SandboxRegistry | null = null;
// Live agent clients keyed by sandbox id (populated on connect, removed on close).
const clients = new Map<string, SandboxAgentClient>();
// The scope the renderer is currently showing. Remote PTY/fs/git route here; null
// = Local (host), in which case the renderer uses the local pty/* surface instead.
let activeSandboxId: string | null = null;
// ptyId → owning sandbox id, so write/resize/kill/replay reach the right agent
// even if the active scope changed since the pty was spawned.
const ptyOwner = new Map<string, string>();

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

export function isAgentCredsSetupUnsupportedError(err: unknown): boolean {
  return describe(err).includes("agent rpc creds.setup timed out");
}

/**
 * Key a clone by the directory it contends for. The repo lands in a fixed
 * `/workspace/<slug>` path inside one sandbox, so the (sandbox, slug) pair is the
 * resource two concurrent clones fight over. The NUL separator can't occur in a
 * sandbox id or slug, and `null` (Local scope) maps to "" — which no real id is —
 * so distinct inputs never collide onto one key.
 */
export function cloneCoordinationKey(sandboxId: string | null, slug: string): string {
  return `${sandboxId ?? ""}\0${slug}`;
}

export type CloneCoordinator = {
  /** Run `work`, or join an in-flight run that shares `key`. */
  run: <T>(key: string, work: () => Promise<T>) => Promise<T>;
  readonly inFlightCount: number;
};

/**
 * Single-flight coordinator for sandbox git clones. Two clones of the same
 * `/workspace/<slug>` race in practice — the create flow's clone
 * (project-sandbox-create.ts) overlapping a TerminalPane's clone-on-open, or
 * several session panes mounting at once — and the loser fails with
 * "destination path already exists and is not an empty directory". Collapse
 * concurrent calls that share a key onto one run: the first caller's clone (and
 * its branch) wins, later callers await the same result. Only *concurrent* calls
 * are deduped; a fresh clone after this one settles starts anew, so an explicit
 * re-clone is never blocked.
 */
export function makeCloneCoordinator(): CloneCoordinator {
  const inFlight = new Map<string, Promise<unknown>>();
  const run = <T>(key: string, work: () => Promise<T>): Promise<T> => {
    const existing = inFlight.get(key) as Promise<T> | undefined;
    if (existing) return existing;
    const p = work();
    inFlight.set(key, p);
    const cleanup = (): void => {
      if (inFlight.get(key) === p) inFlight.delete(key);
    };
    // Settle (resolve or reject) frees the slot; the original `p` still carries
    // the rejection to every joined caller.
    void p.then(cleanup, cleanup);
    return p;
  };
  return {
    run,
    get inFlightCount() {
      return inFlight.size;
    },
  };
}

// One coordinator for the whole manager: every clone — create flow, clone-on-open,
// retry banner — passes through the remoteGitClone handler, so deduping here covers
// all callers regardless of which raced.
const cloneCoordinator = makeCloneCoordinator();

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

function kv() {
  return appSettingsKV(userDataDir);
}

function configFor(id: string): SandboxConfig | null {
  return readSandboxConfig(userDataDir, id);
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
  const id = config.id;
  log.info("sandbox.ws.connect", {
    event: "sandbox.ws.connect",
    sandboxId: id,
    kind: config.kind,
    copyAgentCreds: config.copyAgentCreds,
  });
  const client = new SandboxAgentClient(agentUrl, token, {
    onReady: (version, agents) => {
      cb.onReady(version, agents);
      const agentVersionCurrent = isSandboxAgentVersionCurrent(version);
      log.info("sandbox.agent-creds.connect", {
        event: "sandbox.agent-creds.connect",
        sandboxId: id,
        copyAgentCreds: config.copyAgentCreds,
        agentVersion: version,
        agentVersionCurrent,
        willProvisionCreds: agentVersionCurrent && config.copyAgentCreds,
        agents: Object.keys(agents),
      });
      if (agentVersionCurrent) {
        void provisionGitAuthFor(id).catch((err) =>
          log.warn("sandbox.git-auth.fail", {
            event: "sandbox.git-auth.fail",
            sandboxId: id,
            err: describe(err),
          }),
        );
        void provisionAgentCredsFor(id).catch((err) =>
          log.warn("sandbox.agent-creds.fail", {
            event: "sandbox.agent-creds.fail",
            sandboxId: id,
            err: describe(err),
          }),
        );
      } else {
        log.info("sandbox.agent-creds.skipped", {
          event: "sandbox.agent-creds.skipped",
          sandboxId: id,
          reason: "agent-version-outdated",
          agentVersion: version,
          expectedVersion: EXPECTED_SANDBOX_AGENT_VERSION,
        });
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
    onHook: (slug, taskId, hookEvent, body) => forwardSandboxHook(slug, taskId, hookEvent, body),
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
  const deps: RegistryDeps = { connectAgent, emitState };
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

/** Route a remote-pty op to the pty's owner client (falling back to the active
 *  client). Returns false when no client is available. */
function withOwnerClient(ptyId: string, fn: (client: SandboxAgentClient) => void): boolean {
  const client = ownerClient(ptyId) ?? activeClient();
  if (!client) return false;
  fn(client);
  return true;
}

// Ensure the active sandbox is started, then wait (briefly) for its agent WS to
// connect — a freshly-started remote agent can take a few seconds before it is
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

/** "Keep all running": remote sandboxes reconnect to their configured agent URL. */
async function reconcile(): Promise<void> {
  const configs = listSandboxConfigs(userDataDir);
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
  log.info("sandbox.agent-creds.provision.start", {
    event: "sandbox.agent-creds.provision.start",
    sandboxId: id,
    requireConfigured: !!options.requireConfigured,
    requireTool: options.requireTool ?? null,
  });
  const client = clients.get(id);
  if (!client?.isOpen) {
    log.info("sandbox.agent-creds.provision.skip", {
      event: "sandbox.agent-creds.provision.skip",
      sandboxId: id,
      reason: "client-not-open",
      requireConfigured: !!options.requireConfigured,
    });
    if (options.requireConfigured) throw new Error("sandbox is not connected");
    return { wrote: 0 };
  }
  const config = configFor(id);
  if (!config?.copyAgentCreds) {
    log.info("sandbox.agent-creds.provision.skip", {
      event: "sandbox.agent-creds.provision.skip",
      sandboxId: id,
      reason: "copy-agent-creds-disabled",
      copyAgentCreds: config?.copyAgentCreds ?? null,
      requireConfigured: !!options.requireConfigured,
    });
    if (options.requireConfigured) {
      throw new Error("This sandbox is not set to copy AI tool credentials.");
    }
    return { wrote: 0 };
  }
  const { items, diagnostics } = readHostAgentCredsWithDiagnostics();
  log.info("sandbox.agent-creds.host-read", {
    event: "sandbox.agent-creds.host-read",
    sandboxId: id,
    itemCount: items.length,
    diagnostics,
    tools: [...new Set(items.map((i) => i.tool))],
  });
  if (!items.length) {
    const message =
      "No AI tool credentials were found on the host. Log in locally with claude / codex / cursor-agent / opencode first.";
    if (options.requireConfigured) throw new Error(message);
    log.warn("sandbox.agent-creds.empty", { event: "sandbox.agent-creds.empty", sandboxId: id, diagnostics });
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
      diagnostics,
    });
    return { wrote: 0 };
  }
  try {
    log.info("sandbox.agent-creds.rpc.request", {
      event: "sandbox.agent-creds.rpc.request",
      sandboxId: id,
      method: "creds.setup",
      sent: items.length,
      items: summarizeAgentCredItems(items),
    });
    const r = (await client.rpc("creds.setup", { items })) as {
      wrote?: number;
      written?: Array<{ tool?: unknown; kind?: unknown }>;
    };
    const wrote = r?.wrote ?? 0;
    const wroteRequiredCredential = r.written
      ? r.written.some((item) => item.tool === options.requireTool && item.kind === "credentials")
      : wrote > 0;
    log.info("sandbox.agent-creds.rpc.response", {
      event: "sandbox.agent-creds.rpc.response",
      sandboxId: id,
      method: "creds.setup",
      wrote,
      written: Array.isArray(r?.written)
        ? r.written.map((item) => ({ tool: item.tool, kind: item.kind }))
        : null,
      requireTool: options.requireTool ?? null,
      wroteRequiredCredential,
    });
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
    const message = describe(err);
    if (isAgentCredsSetupUnsupportedError(err)) {
      log.warn("sandbox.agent-creds.unsupported", {
        event: "sandbox.agent-creds.unsupported",
        sandboxId: id,
        err: message,
      });
      return { wrote: 0 };
    }
    log.warn("sandbox.agent-creds.fail", {
      event: "sandbox.agent-creds.fail",
      sandboxId: id,
      err: message,
    });
    if (options.requireConfigured) {
      throw new Error(`Failed to copy AI tool credentials to this sandbox: ${message}`);
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
// local logins and labels each item { tool, kind, content }; the remote agent
// owns where it lands on the VM (creds.setup RPC). Mirrors the SSH copy.
// ─────────────────────────────────────────────────────────────────────────────

type AgentCredItem = {
  tool: "claude" | "codex" | "cursor" | "opencode";
  kind: "credentials" | "state";
  content: string;
};

type AgentCredDiagnostic = {
  tool: AgentCredItem["tool"];
  kind: AgentCredItem["kind"];
  source: "keychain" | "file";
  bytes: number;
  location: string;
};

const MAX_CRED_BYTES = 256 * 1024;
/** ~/.claude.json can be huge (project caches); only a small auth subset is forwarded. */
const MAX_CLAUDE_STATE_SOURCE_BYTES = 4 * 1024 * 1024;

function summarizeAgentCredItems(items: AgentCredItem[]): Array<{
  tool: AgentCredItem["tool"];
  kind: AgentCredItem["kind"];
  bytes: number;
}> {
  return items.map((item) => ({
    tool: item.tool,
    kind: item.kind,
    bytes: Buffer.byteLength(item.content, "utf8"),
  }));
}

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
  if (process.platform !== "darwin") {
    log.debug("sandbox.agent-creds.keychain.skip", {
      event: "sandbox.agent-creds.keychain.skip",
      service,
      reason: "not-darwin",
    });
    return null;
  }
  try {
    const out = execFileSync("security", ["find-generic-password", "-s", service, "-w"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const trimmed = out.replace(/\r?\n$/, "");
    const found = trimmed.length > 0;
    log.debug("sandbox.agent-creds.keychain.read", {
      event: "sandbox.agent-creds.keychain.read",
      service,
      found,
      bytes: found ? Buffer.byteLength(trimmed, "utf8") : 0,
    });
    return found ? trimmed : null;
  } catch (err) {
    log.debug("sandbox.agent-creds.keychain.read", {
      event: "sandbox.agent-creds.keychain.read",
      service,
      found: false,
      err: describe(err),
    });
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
  const full = path.join(os.homedir(), ".claude.json");
  try {
    const st = fs.lstatSync(full);
    if (!st.isFile()) return null;
    if (st.size > MAX_CLAUDE_STATE_SOURCE_BYTES) {
      log.warn("sandbox.agent-creds.claude-state.skip", {
        event: "sandbox.agent-creds.claude-state.skip",
        reason: "source-oversized",
        bytes: st.size,
        maxBytes: MAX_CLAUDE_STATE_SOURCE_BYTES,
        location: "~/.claude.json",
      });
      return null;
    }
    const raw = fs.readFileSync(full, "utf8");
    if (!raw) return null;
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      log.warn("sandbox.agent-creds.claude-state.skip", {
        event: "sandbox.agent-creds.claude-state.skip",
        reason: "invalid-json",
        location: "~/.claude.json",
      });
      return null;
    }
    const trimmed: Record<string, unknown> = {};
    for (const key of CLAUDE_STATE_KEYS) {
      if (parsed[key] !== undefined) trimmed[key] = parsed[key];
    }
    if (!Object.keys(trimmed).length) {
      log.debug("sandbox.agent-creds.claude-state.skip", {
        event: "sandbox.agent-creds.claude-state.skip",
        reason: "no-allowlisted-keys",
        location: "~/.claude.json",
      });
      return null;
    }
    const serialized = JSON.stringify(trimmed);
    const bytes = Buffer.byteLength(serialized, "utf8");
    if (bytes > MAX_CRED_BYTES) {
      log.warn("sandbox.agent-creds.claude-state.skip", {
        event: "sandbox.agent-creds.claude-state.skip",
        reason: "trimmed-oversized",
        bytes,
        maxBytes: MAX_CRED_BYTES,
        location: "~/.claude.json",
      });
      return null;
    }
    log.debug("sandbox.agent-creds.claude-state.read", {
      event: "sandbox.agent-creds.claude-state.read",
      sourceBytes: st.size,
      trimmedBytes: bytes,
      keys: Object.keys(trimmed),
    });
    return serialized;
  } catch (err) {
    log.debug("sandbox.agent-creds.claude-state.skip", {
      event: "sandbox.agent-creds.claude-state.skip",
      reason: "read-failed",
      location: "~/.claude.json",
      err: describe(err),
    });
    return null;
  }
}

function pushAgentCred(
  out: AgentCredItem[],
  diagnostics: AgentCredDiagnostic[],
  item: AgentCredItem | null,
  diagnostic: AgentCredDiagnostic | null,
): void {
  if (!item?.content) return;
  const bytes = Buffer.byteLength(item.content, "utf8");
  if (bytes > MAX_CRED_BYTES) {
    log.warn("sandbox.agent-creds.host-read.skip", {
      event: "sandbox.agent-creds.host-read.skip",
      tool: item.tool,
      kind: item.kind,
      reason: "oversized",
      bytes,
      maxBytes: MAX_CRED_BYTES,
      location: diagnostic?.location ?? null,
    });
    return;
  }
  out.push(item);
  if (diagnostic) diagnostics.push({ ...diagnostic, bytes });
}

/** Read the host's AI-CLI logins to push into a sandbox (copyAgentCreds mode). */
export function readHostAgentCredsWithDiagnostics(): {
  items: AgentCredItem[];
  diagnostics: AgentCredDiagnostic[];
} {
  const out: AgentCredItem[] = [];
  const diagnostics: AgentCredDiagnostic[] = [];

  // Claude Code: token in the macOS Keychain, or ~/.claude/.credentials.json on
  // a Linux host. Plus a trimmed copy of the onboarding/account state.
  const claudeKeychain = readKeychainSecret("Claude Code-credentials");
  const claudeFile = claudeKeychain ? null : readHostCredFile(".claude", ".credentials.json");
  const claudeCred = claudeKeychain ?? claudeFile;
  if (claudeCred) {
    pushAgentCred(
      out,
      diagnostics,
      { tool: "claude", kind: "credentials", content: claudeCred },
      claudeKeychain
        ? { tool: "claude", kind: "credentials", source: "keychain", bytes: 0, location: "Claude Code-credentials" }
        : { tool: "claude", kind: "credentials", source: "file", bytes: 0, location: "~/.claude/.credentials.json" },
    );
  }
  const claudeState = readClaudeState();
  if (claudeState) {
    pushAgentCred(
      out,
      diagnostics,
      { tool: "claude", kind: "state", content: claudeState },
      { tool: "claude", kind: "state", source: "file", bytes: 0, location: "~/.claude.json" },
    );
  }

  // Codex: plain file at ~/.codex/auth.json on every platform.
  const codexCred = readHostCredFile(".codex", "auth.json");
  if (codexCred) {
    pushAgentCred(
      out,
      diagnostics,
      { tool: "codex", kind: "credentials", content: codexCred },
      { tool: "codex", kind: "credentials", source: "file", bytes: 0, location: "~/.codex/auth.json" },
    );
  }

  // Cursor: access + refresh tokens live in the macOS Keychain; the VM reads a
  // file-based auth.json. On a Linux host, copy that file directly.
  const cursorAccess = readKeychainSecret("cursor-access-token");
  const cursorRefresh = readKeychainSecret("cursor-refresh-token");
  if (cursorAccess) {
    pushAgentCred(
      out,
      diagnostics,
      {
        tool: "cursor",
        kind: "credentials",
        content: JSON.stringify({ accessToken: cursorAccess, refreshToken: cursorRefresh ?? cursorAccess }),
      },
      { tool: "cursor", kind: "credentials", source: "keychain", bytes: 0, location: "cursor-access-token" },
    );
  } else {
    const cursorFile = readHostCredFile(".config", "cursor-agent", "auth.json");
    if (cursorFile) {
      pushAgentCred(
        out,
        diagnostics,
        { tool: "cursor", kind: "credentials", content: cursorFile },
        {
          tool: "cursor",
          kind: "credentials",
          source: "file",
          bytes: 0,
          location: "~/.config/cursor-agent/auth.json",
        },
      );
    }
  }

  // OpenCode: plain file at ~/.local/share/opencode/auth.json.
  const opencodeCred = readHostCredFile(".local", "share", "opencode", "auth.json");
  if (opencodeCred) {
    pushAgentCred(
      out,
      diagnostics,
      { tool: "opencode", kind: "credentials", content: opencodeCred },
      {
        tool: "opencode",
        kind: "credentials",
        source: "file",
        bytes: 0,
        location: "~/.local/share/opencode/auth.json",
      },
    );
  }

  return { items: out, diagnostics };
}

/** Read the host's AI-CLI logins to push into a sandbox (copyAgentCreds mode). */
export function readHostAgentCreds(): AgentCredItem[] {
  return readHostAgentCredsWithDiagnostics().items;
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
  _appRoot: string,
  hookEnvAccessor?: () => { port: number; token: string } | null,
): void {
  if (initialized) return;
  initialized = true;
  getWindow = windowAccessor;
  userDataDir = appUserDataDir;
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
      return { dockerAvailable: true, states: getRegistry().allStates() };
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
      log.info("sandbox.agent-creds.pty-spawn", {
        event: "sandbox.agent-creds.pty-spawn",
        sandboxId: id,
        agent: opts.agent ?? null,
        copyAgentCreds: config?.copyAgentCreds ?? false,
        requiredTool,
        willProvisionBeforeSpawn: !!(id && config?.copyAgentCreds && requiredTool),
      });
      if (id && config?.copyAgentCreds && requiredTool) {
        await provisionAgentCredsFor(id, { requireConfigured: true, requireTool: requiredTool });
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
    return withOwnerClient(ptyId, (c) => c.write(ptyId, data));
  }, ipcMain);
  safeHandle(IPC.remotePtyResize, (_e, ptyId: string, cols: number, rows: number) => {
    return withOwnerClient(ptyId, (c) => c.resize(ptyId, cols, rows));
  }, ipcMain);
  safeHandle(IPC.remotePtyKill, (_e, ptyId: string) => {
    ptyOwner.delete(ptyId);
    return withOwnerClient(ptyId, (c) => c.kill(ptyId));
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
      }, REMOTE_PTY_REPLAY_TIMEOUT_MS);
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
      timeoutMs: method === "git.clone" ? GIT_CLONE_TIMEOUT_MS : undefined,
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
    (_e, remote: string, slug: string, branch?: string) => {
      const id = activeSandboxId;
      // Single-flight by (sandbox, slug): a create-flow clone racing a
      // TerminalPane clone-on-open (or several panes at once) target the same
      // /workspace/<slug> dir; share one git.clone so the loser doesn't fail with
      // "destination path already exists". First caller (with its branch) wins.
      return cloneCoordinator.run(cloneCoordinationKey(id, slug), async () => {
        if (id && isSafeSshCloneRemote(remote)) {
          await provisionGitAuthFor(id, { requireConfigured: true });
        }
        const cloneParams = branch ? { remote, slug, branch } : { remote, slug };
        try {
          return await activeGitRpc("git.clone", cloneParams);
        } catch (err) {
          const cfg = id ? configFor(id) : null;
          if (id && isSafeSshCloneRemote(remote)) {
            const hint = gitAuthCloneFailureHint(cfg?.gitAuthMode ?? "none", err);
            if (hint) throw new Error(`${describe(err)}\n\n${hint}`);
          }
          throw err;
        }
      });
    },
    ipcMain,
  );
}

export function disposeSandboxManager(): void {
  registry?.disposeAll();
  for (const c of clients.values()) c.close();
  clients.clear();
}
