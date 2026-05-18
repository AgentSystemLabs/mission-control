import { createHash, randomBytes, randomUUID } from "node:crypto";
import { Daytona, DaytonaNotFoundError, type PtyHandle, type Sandbox } from "@daytona/sdk";
import type { HostedAuthContext } from "../hosted-auth-context";
import { installRemoteAgentHooks } from "./remote-agent-hooks";
import { revokeHostedHookTokens } from "./hosted-hook-tokens";
import { logHostedEvent } from "./hosted-logs";
import { incrementHostedCounter, setHostedGauge } from "./hosted-metrics";
import { readEntitlements } from "./entitlements";
import { hostedComputeLimitStatus } from "./hosted-plan-limits";
import {
  recordHostedRuntimeEnd,
  recordHostedRuntimeStart,
} from "./hosted-runtime-usage";
import { HOSTED_WORKSPACE_ROOT } from "~/shared/hosted-workspace";
import { normalizePtySize } from "~/shared/pty-size";

type RemotePty = {
  id: string;
  userId: string;
  organizationId: string | null;
  projectId: string;
  pty: PtyHandle;
  buffer: RemotePtyOutput[];
  bufferBytes: number;
  nextSeq: number;
  listeners: Set<(event: RemotePtyEvent) => void>;
  exitEvent?: RemotePtyEvent;
  cleanupTimer?: ReturnType<typeof setTimeout>;
  computeLimitTimer?: ReturnType<typeof setTimeout>;
  runtimeStartPromise?: Promise<void>;
  context: HostedAuthContext;
  taskId?: string;
};

export type RemotePtyEvent =
  | { type: "output"; ptyId: string; seq: number; data: string }
  | { type: "exit"; ptyId: string; exitCode?: number; error?: string };

type RemotePtyOutput = {
  seq: number;
  data: string;
};

type RemotePtyTicket = {
  ptyId: string;
  userId: string;
  organizationId: string | null;
  expiresAt: number;
};

export type RemotePtySpawnInput = {
  context: HostedAuthContext;
  taskId?: string;
  projectId: string;
  cwd: string;
  command: string;
  githubUrl?: string | null;
  agent?: string;
  hookEnv?: {
    apiUrl: string;
    token: string;
  } | null;
  cols?: number;
  rows?: number;
};

type RemoteProjectRepositoryInput = {
  context: HostedAuthContext;
  projectId: string;
  path: string;
  githubUrl: string;
};

const DEFAULT_RETAINED_OUTPUT_BUFFER_BYTES = 1_000_000;
const DEFAULT_COMPUTE_LIMIT_POLL_MS = 60_000;
const DEFAULT_DAYTONA_SNAPSHOT = "mission-control-cloud-agents";
const EXITED_PTY_TTL_MS = 5 * 60_000;
const tickets = new Map<string, RemotePtyTicket>();
const TICKET_TTL_MS = 30_000;

let daytona: Daytona | null = null;
const sandboxes = new Map<string, Sandbox>();
const sandboxPromises = new Map<string, Promise<Sandbox>>();
const ptys = new Map<string, RemotePty>();
const pendingPtySpawns = new Map<string, number>();

function sandboxIdentifier(sandbox: Sandbox): string | null {
  const maybe = sandbox as unknown as { id?: unknown; name?: unknown };
  if (typeof maybe.id === "string" && maybe.id.trim()) return maybe.id;
  if (typeof maybe.name === "string" && maybe.name.trim()) return maybe.name;
  return null;
}

function logRuntimeUsageFailure(action: "start" | "end", ptyId: string, error: unknown): void {
  logHostedEvent(
    `runtime_usage.${action}_failed`,
    {
      ptyId,
      error: error instanceof Error ? error.message : String(error),
    },
    "error",
  );
}

function envNumber(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function remoteRuntimeDisabled(): boolean {
  const value = process.env.MC_REMOTE_RUNTIME_DISABLED?.trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes";
}

export function remotePtyScopeKey(context: HostedAuthContext): string {
  return `user:${context.userId}`;
}

function pendingRemotePtySpawns(context: HostedAuthContext): number {
  return pendingPtySpawns.get(remotePtyScopeKey(context)) ?? 0;
}

function reserveRemotePtySpawn(context: HostedAuthContext): (() => void) | null {
  const key = remotePtyScopeKey(context);
  if (countActiveRemotePtys(context) + pendingRemotePtySpawns(context) >= maxActiveRemotePtysPerScope()) {
    return null;
  }
  pendingPtySpawns.set(key, pendingRemotePtySpawns(context) + 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const next = (pendingPtySpawns.get(key) ?? 1) - 1;
    if (next > 0) pendingPtySpawns.set(key, next);
    else pendingPtySpawns.delete(key);
  };
}

export function maxActiveRemotePtysPerScope(): number {
  return envNumber("MC_MAX_ACTIVE_PTYS_PER_USER", 5);
}

export function maxRetainedRemotePtyOutputBytes(): number {
  return envNumber("MC_REMOTE_PTY_OUTPUT_BUFFER_BYTES", DEFAULT_RETAINED_OUTPUT_BUFFER_BYTES);
}

function computeLimitPollMs(): number {
  return envNumber("MC_COMPUTE_LIMIT_POLL_MS", DEFAULT_COMPUTE_LIMIT_POLL_MS);
}

function daytonaSnapshotName(): string {
  return process.env.DAYTONA_SNAPSHOT?.trim() || DEFAULT_DAYTONA_SNAPSHOT;
}

function unrefTimer(timer: ReturnType<typeof setTimeout>): void {
  (timer as ReturnType<typeof setTimeout> & { unref?: () => void }).unref?.();
}

function getDaytonaClient() {
  if (daytona) return daytona;
  const apiKey = process.env.DAYTONA_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("DAYTONA_API_KEY is required for web Daytona runtime");
  }
  daytona = new Daytona({
    apiKey,
    apiUrl: process.env.DAYTONA_API_URL?.trim() || undefined,
    target: process.env.DAYTONA_TARGET?.trim() || undefined,
  });
  return daytona;
}

function stableSandboxName(input: RemotePtySpawnInput): string {
  const configuredPrefix =
    process.env.DAYTONA_SANDBOX_NAME_PREFIX?.trim() ||
    process.env.DAYTONA_SANDBOX_NAME?.trim() ||
    "mission-control";
  const scope = `user:${input.context.userId}`;
  const hash = createHash("sha256").update(scope).digest("hex").slice(0, 16);
  return `${configuredPrefix}-${hash}`;
}

function sandboxScopeHash(context: HostedAuthContext): string {
  return createHash("sha256").update(`user:${context.userId}`).digest("hex").slice(0, 16);
}

async function ensureSandbox(input: RemotePtySpawnInput) {
  const name = stableSandboxName(input);
  const cached = sandboxes.get(name);
  if (cached) return cached;
  if (!sandboxPromises.has(name)) {
    sandboxPromises.set(name, getOrCreateSandbox(name, input));
  }

  try {
    const sandbox = await sandboxPromises.get(name)!;
    sandboxes.set(name, sandbox);
    return sandbox;
  } finally {
    sandboxPromises.delete(name);
  }
}

async function getOrCreateSandbox(name: string, input: RemotePtySpawnInput) {
  const client = getDaytonaClient();
  try {
    const sandbox = await client.get(name);
    await ensureSandboxStarted(client, sandbox);
    return sandbox;
  } catch (error) {
    if (!(error instanceof DaytonaNotFoundError)) {
      throw error;
    }
  }

  const sandbox = await client.create(
    {
      name,
      snapshot: daytonaSnapshotName(),
      labels: {
        app: "mission-control",
        runtime: "web-daytona",
        owner: input.context.organizationId ? "organization" : "user",
        scopeHash: sandboxScopeHash(input.context),
      },
      autoStopInterval: Number(process.env.DAYTONA_AUTO_STOP_MINUTES ?? 15),
    },
    { timeout: 120 },
  ).catch(async (error: unknown) => {
    if (!isDaytonaConflictError(error)) throw error;
    const existing = await client.get(name);
    await ensureSandboxStarted(client, existing);
    return existing;
  });
  await ensureSandboxStarted(client, sandbox);
  return sandbox;
}

export async function deleteRemoteSandboxesForProject(
  context: HostedAuthContext,
  projectId: string,
): Promise<void> {
  const client = getDaytonaClient();
  const labels = {
    app: "mission-control",
    runtime: "web-daytona",
    scopeHash: sandboxScopeHash(context),
    projectId,
  };
  for (;;) {
    const result = await client.list(labels, 1, 50);
    for (const sandbox of result.items ?? []) {
      try {
        await client.delete(sandbox, 60);
      } catch (error) {
        if (isDaytonaNotFoundError(error)) continue;
        await client.stop(sandbox).catch(() => undefined);
        throw error;
      }
    }
    if (!result.items?.length || result.items.length < 50) break;
  }
}

export async function deleteRemoteSandboxesForTask(
  context: HostedAuthContext,
  projectId: string,
  taskId: string,
): Promise<void> {
  const client = getDaytonaClient();
  const labels = {
    app: "mission-control",
    runtime: "web-daytona",
    scopeHash: sandboxScopeHash(context),
    projectId,
    taskId,
  };
  for (;;) {
    const result = await client.list(labels, 1, 50);
    for (const sandbox of result.items ?? []) {
      try {
        await client.delete(sandbox, 60);
      } catch (error) {
        if (isDaytonaNotFoundError(error)) continue;
        await client.stop(sandbox).catch(() => undefined);
        throw error;
      }
    }
    if (!result.items?.length || result.items.length < 50) break;
  }
}

export async function deleteRemoteSandboxByIdOrName(idOrName: string | null | undefined): Promise<void> {
  const target = idOrName?.trim();
  if (!target) return;
  const client = getDaytonaClient();
  const sandbox = await client.get(target).catch((error: unknown) => {
    if (isDaytonaNotFoundError(error)) return null;
    throw error;
  });
  if (!sandbox) return;
  try {
    await client.delete(sandbox, 60);
  } catch (error) {
    if (isDaytonaNotFoundError(error)) return;
    await client.stop(sandbox).catch(() => undefined);
    throw error;
  }
}

function isDaytonaNotFoundError(error: unknown): boolean {
  const maybe = error as { status?: number; statusCode?: number; response?: { status?: number } };
  return (
    error instanceof DaytonaNotFoundError ||
    maybe.status === 404 ||
    maybe.statusCode === 404 ||
    maybe.response?.status === 404
  );
}

function isDaytonaConflictError(error: unknown): boolean {
  const maybe = error as { status?: number; statusCode?: number; response?: { status?: number } };
  return maybe.status === 409 || maybe.statusCode === 409 || maybe.response?.status === 409;
}

async function ensureSandboxStarted(client: Daytona, sandbox: Sandbox) {
  if (sandbox.state && sandbox.state !== "started") {
    await client.start(sandbox, 120);
  }
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\"'\"'")}'`;
}

function parentRemotePath(remotePath: string): string {
  const normalized = remotePath.replace(/\/+$/g, "");
  const idx = normalized.lastIndexOf("/");
  return idx <= 0 ? "/" : normalized.slice(0, idx);
}

async function readRemoteGitBranch(sandbox: Sandbox, remotePath: string): Promise<string | null> {
  try {
    const status = await sandbox.git.status(remotePath);
    return typeof status.currentBranch === "string" && status.currentBranch.trim()
      ? status.currentBranch.trim()
      : null;
  } catch {
    return null;
  }
}

async function ensureRepositoryCloned(
  sandbox: Sandbox,
  remotePath: string,
  githubUrl: string,
): Promise<string | null> {
  const prepared = await sandbox.process.executeCommand(
    `mkdir -p ${shellQuote(parentRemotePath(remotePath))}`,
    "/",
    undefined,
    30,
  );
  if (prepared.exitCode !== 0) {
    throw new Error(prepared.result || "failed to prepare remote workspace directory");
  }
  const existingBranch = await readRemoteGitBranch(sandbox, remotePath);
  if (existingBranch) return existingBranch;
  await sandbox.git.clone(githubUrl, remotePath);
  return readRemoteGitBranch(sandbox, remotePath);
}

function isRemotePtyShellFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return (
    /fork\/exec .* no such file or directory/i.test(message) ||
    /PTY (?:login )?shell|configured PTY shell/i.test(message)
  );
}

async function prepareSandboxForPty(
  input: RemotePtySpawnInput,
  sandbox: Sandbox,
): Promise<void> {
  if (input.githubUrl?.trim()) {
    await ensureRepositoryCloned(sandbox, input.cwd || HOSTED_WORKSPACE_ROOT, input.githubUrl.trim());
  }
  if (input.taskId && input.agent && input.hookEnv) {
    await installRemoteAgentHooks(sandbox, { agent: input.agent, cwd: input.cwd || HOSTED_WORKSPACE_ROOT });
  }
}

export async function ensureRemoteProjectRepository(
  input: RemoteProjectRepositoryInput,
): Promise<{ sandboxId: string | null; branch: string | null }> {
  const sandbox = await ensureSandbox({
    context: input.context,
    projectId: input.projectId,
    cwd: input.path,
    command: "",
  });
  return {
    sandboxId: sandboxIdentifier(sandbox),
    branch: await ensureRepositoryCloned(sandbox, input.path, input.githubUrl),
  };
}

function appendBuffer(remote: RemotePty, chunk: string): RemotePtyOutput {
  const output = { seq: remote.nextSeq++, data: chunk };
  remote.buffer.push(output);
  remote.bufferBytes += Buffer.byteLength(chunk, "utf8");
  const limitBytes = maxRetainedRemotePtyOutputBytes();
  while (remote.bufferBytes > limitBytes && remote.buffer.length > 1) {
    const dropped = remote.buffer.shift()!;
    remote.bufferBytes -= Buffer.byteLength(dropped.data, "utf8");
  }
  return output;
}

function emit(remote: RemotePty, event: RemotePtyEvent) {
  for (const listener of remote.listeners) listener(event);
}

function clearComputeLimitTimer(remote: RemotePty): void {
  if (remote.computeLimitTimer) {
    clearTimeout(remote.computeLimitTimer);
    remote.computeLimitTimer = undefined;
  }
}

function isCurrentActiveRemote(remote: RemotePty): boolean {
  const current = ptys.get(remote.id);
  return current === remote && !remote.exitEvent;
}

function retainExitedPty(remote: RemotePty, event: Extract<RemotePtyEvent, { type: "exit" }>) {
  if (remote.exitEvent) return;
  clearComputeLimitTimer(remote);
  remote.exitEvent = event;
  emit(remote, event);
  if (event.error) incrementHostedCounter("remotePtyFailures");
  logHostedEvent(
    event.error ? "remote_pty.exit_error" : "remote_pty.exited",
    {
      ptyId: remote.id,
      projectId: remote.projectId,
      taskId: remote.taskId ?? null,
      userId: remote.userId,
      organizationId: remote.organizationId,
      exitCode: event.exitCode ?? null,
      error: event.error ?? null,
    },
    event.error ? "warn" : "info",
  );
  if (remote.taskId) {
    void revokeHostedHookTokens(remote.taskId).catch(() => undefined);
  }
  void (remote.runtimeStartPromise ?? Promise.resolve())
    .then(() => recordHostedRuntimeEnd(remote.id))
    .catch((error) => {
      logRuntimeUsageFailure("end", remote.id, error);
    });
  remote.cleanupTimer = setTimeout(() => {
    ptys.delete(remote.id);
    setHostedGauge("activeRemotePtys", totalActiveRemotePtys());
  }, EXITED_PTY_TTL_MS);
  unrefTimer(remote.cleanupTimer);
}

async function enforceActiveRemotePtyComputeLimit(remote: RemotePty): Promise<void> {
  if (!isCurrentActiveRemote(remote)) return;

  try {
    const entitlements = await readEntitlements(remote.context);
    if (!isCurrentActiveRemote(remote)) return;
    if (!entitlements.remoteRuntime.allowed) {
      logHostedEvent(
        "remote_pty.entitlement_revoked",
        {
          ptyId: remote.id,
          projectId: remote.projectId,
          taskId: remote.taskId ?? null,
          userId: remote.userId,
          organizationId: remote.organizationId,
          reason: entitlements.remoteRuntime.reason,
        },
        "warn",
      );
      await remote.pty.kill().catch(() => undefined);
      if (!isCurrentActiveRemote(remote)) return;
      await remote.pty.disconnect().catch(() => undefined);
      retainExitedPty(remote, {
        type: "exit",
        ptyId: remote.id,
        error: "Hosted remote runtime access revoked.",
      });
      setHostedGauge("activeRemotePtys", totalActiveRemotePtys());
      return;
    }

    const status = await hostedComputeLimitStatus(remote.context);
    if (!isCurrentActiveRemote(remote)) return;
    if (status.allowed) {
      scheduleComputeLimitCheck(remote);
      return;
    }

    logHostedEvent(
      "remote_pty.compute_limit_reached",
      {
        ptyId: remote.id,
        projectId: remote.projectId,
        taskId: remote.taskId ?? null,
        userId: remote.userId,
        organizationId: remote.organizationId,
        limit: status.limitSeconds,
        current: status.usedSeconds,
        windowDays: status.windowDays,
        currentPeriodStartsAt: status.currentPeriodStartsAt,
      },
      "warn",
    );
    await remote.pty.kill().catch(() => undefined);
    if (!isCurrentActiveRemote(remote)) return;
    await remote.pty.disconnect().catch(() => undefined);
    retainExitedPty(remote, {
      type: "exit",
      ptyId: remote.id,
      error: "Hosted compute limit reached.",
    });
    setHostedGauge("activeRemotePtys", totalActiveRemotePtys());
  } catch (error) {
    logHostedEvent(
      "remote_pty.compute_limit_check_failed",
      {
        ptyId: remote.id,
        projectId: remote.projectId,
        taskId: remote.taskId ?? null,
        error: error instanceof Error ? error.message : String(error),
      },
      "error",
    );
    scheduleComputeLimitCheck(remote);
  }
}

function scheduleComputeLimitCheck(remote: RemotePty): void {
  if (remote.exitEvent) return;
  clearComputeLimitTimer(remote);
  remote.computeLimitTimer = setTimeout(() => {
    void enforceActiveRemotePtyComputeLimit(remote);
  }, computeLimitPollMs());
  unrefTimer(remote.computeLimitTimer);
}

function totalActiveRemotePtys(): number {
  let count = 0;
  for (const remote of ptys.values()) {
    if (!remote.exitEvent) count += 1;
  }
  return count;
}

export async function spawnRemotePty(input: RemotePtySpawnInput): Promise<{ ptyId: string }> {
  const releaseSpawnReservation = reserveRemotePtySpawn(input.context);
  if (!releaseSpawnReservation) {
    logHostedEvent(
      "remote_pty.spawn_denied",
      {
        projectId: input.projectId,
        taskId: input.taskId ?? null,
        userId: input.context.userId,
        organizationId: input.context.organizationId,
        reason: "active_limit",
        activeLimit: maxActiveRemotePtysPerScope(),
      },
      "warn",
    );
    throw new Error("active remote terminal limit reached");
  }
  logHostedEvent("remote_pty.spawn_start", {
    projectId: input.projectId,
    taskId: input.taskId ?? null,
    userId: input.context.userId,
    organizationId: input.context.organizationId,
    agent: input.agent ?? null,
  });
  const ptyId = `rpty-${Date.now()}-${randomUUID().slice(0, 8)}`;
  const decoder = new TextDecoder();
  let remote: RemotePty | null = null;
  let sandbox: Sandbox;
  let pty: PtyHandle;
  try {
    const ptySize = normalizePtySize(input);
    sandbox = await ensureSandbox(input);
    try {
      await prepareSandboxForPty(input, sandbox);
    } catch (error) {
      if (!isRemotePtyShellFailure(error)) throw error;
      logHostedEvent(
        "remote_pty.shell_failure",
        {
          projectId: input.projectId,
          taskId: input.taskId ?? null,
          error: error instanceof Error ? error.message : String(error),
        },
        "warn",
      );
      throw error;
    }
    const createPtyOptions = {
      id: ptyId,
      cols: ptySize.cols,
      rows: ptySize.rows,
      envs: {
        LANG: "en_US.UTF-8",
        TERM: "xterm-256color",
        MC_PROJECT_ID: input.projectId,
        ...(input.taskId ? { MC_TASK_ID: input.taskId } : {}),
        ...(input.hookEnv
          ? {
              MC_API_URL: input.hookEnv.apiUrl,
              MC_API_TOKEN: input.hookEnv.token,
            }
          : {}),
      },
      onData: (data: Uint8Array) => {
        if (!remote) return;
        const text = decoder.decode(data, { stream: true });
        const output = appendBuffer(remote, text);
        emit(remote, { type: "output", ptyId, ...output });
      },
    };
    try {
      pty = await sandbox.process.createPty(createPtyOptions);
    } catch (error) {
      if (!isRemotePtyShellFailure(error)) throw error;
      logHostedEvent(
        "remote_pty.shell_failure",
        {
          projectId: input.projectId,
          taskId: input.taskId ?? null,
          error: error instanceof Error ? error.message : String(error),
        },
        "warn",
      );
      throw error;
    }
  } catch (error) {
    releaseSpawnReservation();
    throw error;
  }

  remote = {
    id: ptyId,
    userId: input.context.userId,
    organizationId: input.context.organizationId,
    projectId: input.projectId,
    pty,
    buffer: [],
    bufferBytes: 0,
    nextSeq: 1,
    listeners: new Set(),
    context: input.context,
    taskId: input.taskId,
  };
  ptys.set(ptyId, remote);
  releaseSpawnReservation();
  try {
    await pty.waitForConnection();
    if (input.cwd.trim()) {
      await pty.sendInput(`cd ${shellQuote(input.cwd.trim())}\r`);
    }
    if (input.command.trim()) {
      await pty.sendInput(`${input.command}\r`);
    }
  } catch (error) {
    ptys.delete(ptyId);
    if (input.taskId) {
      await revokeHostedHookTokens(input.taskId).catch(() => undefined);
    }
    await pty.kill().catch(() => undefined);
    await pty.disconnect().catch(() => undefined);
    incrementHostedCounter("remotePtyFailures");
    setHostedGauge("activeRemotePtys", totalActiveRemotePtys());
    logHostedEvent(
      "remote_pty.spawn_failed",
      {
        ptyId,
        projectId: input.projectId,
        taskId: input.taskId ?? null,
        error: error instanceof Error ? error.message : String(error),
      },
      "error",
    );
    throw error;
  }
  remote.runtimeStartPromise = recordHostedRuntimeStart({
    context: input.context,
    projectId: input.projectId,
    taskId: input.taskId ?? null,
    ptyId,
    sandboxId: sandboxIdentifier(sandbox),
  }).catch((error) => {
    logRuntimeUsageFailure("start", ptyId, error);
  });
  logHostedEvent("remote_pty.spawn_ready", {
    ptyId,
    projectId: input.projectId,
    taskId: input.taskId ?? null,
    userId: input.context.userId,
    organizationId: input.context.organizationId,
  });
  incrementHostedCounter("remotePtyStarts");
  setHostedGauge("activeRemotePtys", totalActiveRemotePtys());
  scheduleComputeLimitCheck(remote);
  void pty.wait().then((result) => {
    const current = ptys.get(ptyId);
    if (!current || current.exitEvent) return;
    retainExitedPty(current, {
      type: "exit",
      ptyId,
      exitCode: result.exitCode,
      error: result.error,
    });
  }).catch((error) => {
    const current = ptys.get(ptyId);
    if (!current || current.exitEvent) return;
    logHostedEvent(
      "remote_pty.wait_failed",
      {
        ptyId,
        projectId: input.projectId,
        taskId: input.taskId ?? null,
        error: error instanceof Error ? error.message : String(error),
      },
      "error",
    );
    retainExitedPty(current, {
      type: "exit",
      ptyId,
      error: error instanceof Error ? error.message : String(error),
    });
  });

  return { ptyId };
}

function getOwnedRemotePty(context: HostedAuthContext, ptyId: string): RemotePty | null {
  const remote = ptys.get(ptyId);
  if (!remote) return null;
  if (remote.organizationId !== context.organizationId) return null;
  if (remote.userId !== context.userId) return null;
  return remote;
}

export function countActiveRemotePtys(context: HostedAuthContext): number {
  let count = 0;
  for (const remote of ptys.values()) {
    if (remote.exitEvent) continue;
    if (remote.organizationId !== context.organizationId) continue;
    if (remote.userId !== context.userId) continue;
    count += 1;
  }
  return count;
}

export function listActiveRemotePtySummaries(): Array<{
  ptyId: string;
  userId: string;
  organizationId: string | null;
  projectId: string;
  taskId: string | null;
  bufferedBytes: number;
  listenerCount: number;
}> {
  return Array.from(ptys.values())
    .filter((remote) => !remote.exitEvent)
    .map((remote) => ({
      ptyId: remote.id,
      userId: remote.userId,
      organizationId: remote.organizationId,
      projectId: remote.projectId,
      taskId: remote.taskId ?? null,
      bufferedBytes: remote.bufferBytes,
      listenerCount: remote.listeners.size,
    }));
}

export function resetDaytonaRemotePtyStateForTests(): void {
  if (!process.env.VITEST) return;
  daytona = null;
  sandboxes.clear();
  sandboxPromises.clear();
  ptys.clear();
  pendingPtySpawns.clear();
  tickets.clear();
}

export async function writeRemotePty(
  context: HostedAuthContext,
  ptyId: string,
  data: string,
): Promise<boolean> {
  const remote = getOwnedRemotePty(context, ptyId);
  if (!remote) return false;
  if (remote.exitEvent) return false;
  await remote.pty.sendInput(data);
  return true;
}

export async function resizeRemotePty(
  context: HostedAuthContext,
  ptyId: string,
  cols: number,
  rows: number,
): Promise<boolean> {
  const remote = getOwnedRemotePty(context, ptyId);
  if (!remote) return false;
  if (remote.exitEvent) return false;
  const ptySize = normalizePtySize({ cols, rows });
  await remote.pty.resize(ptySize.cols, ptySize.rows);
  return true;
}

export async function killRemotePty(context: HostedAuthContext, ptyId: string): Promise<boolean> {
  const remote = getOwnedRemotePty(context, ptyId);
  if (!remote) {
    logHostedEvent("remote_pty.kill_not_found", { ptyId, userId: context.userId }, "warn");
    return false;
  }
  try {
    await remote.pty.kill();
  } finally {
    clearComputeLimitTimer(remote);
    if (remote.taskId) {
      await revokeHostedHookTokens(remote.taskId).catch(() => undefined);
    }
    await remote.runtimeStartPromise?.catch(() => undefined);
    await recordHostedRuntimeEnd(remote.id).catch((error) => {
      logRuntimeUsageFailure("end", remote.id, error);
    });
    await remote.pty.disconnect().catch(() => undefined);
    if (remote.cleanupTimer) clearTimeout(remote.cleanupTimer);
    ptys.delete(ptyId);
    setHostedGauge("activeRemotePtys", totalActiveRemotePtys());
  }
  logHostedEvent("remote_pty.killed", {
    ptyId,
    userId: context.userId,
    organizationId: context.organizationId,
    taskId: remote.taskId ?? null,
  });
  return true;
}

export async function killRemotePtysForProject(
  context: HostedAuthContext,
  projectId: string,
): Promise<void> {
  const owned = Array.from(ptys.values())
    .filter((remote) =>
      !remote.exitEvent &&
      remote.organizationId === context.organizationId &&
      remote.userId === context.userId &&
      remote.projectId === projectId
    )
    .map((remote) => remote.id);
  await Promise.all(owned.map((ptyId) => killRemotePty(context, ptyId)));
}

export async function killRemotePtysForTask(
  context: HostedAuthContext,
  taskId: string,
): Promise<void> {
  const owned = Array.from(ptys.values())
    .filter((remote) =>
      !remote.exitEvent &&
      remote.organizationId === context.organizationId &&
      remote.userId === context.userId &&
      remote.taskId === taskId
    )
    .map((remote) => remote.id);
  await Promise.all(owned.map((ptyId) => killRemotePty(context, ptyId)));
}

export function replayRemotePty(
  context: HostedAuthContext,
  ptyId: string,
  opts: { afterSeq?: number; beforeSeq?: number } = {},
): { data: string; nextSeq: number } | null {
  const remote = getOwnedRemotePty(context, ptyId);
  if (!remote) return null;
  const afterSeq = opts.afterSeq ?? 0;
  const beforeSeq = opts.beforeSeq ?? Number.MAX_SAFE_INTEGER;
  const data = remote.buffer
    .filter((chunk) => chunk.seq > afterSeq && chunk.seq <= beforeSeq)
    .map((chunk) => chunk.data)
    .join("");
  return { data, nextSeq: remote.nextSeq };
}

export function subscribeRemotePty(
  ptyId: string,
  listener: (event: RemotePtyEvent) => void,
): { unsubscribe: () => void; replayBeforeSeq: number } | null {
  const remote = ptys.get(ptyId);
  if (!remote) return null;
  remote.listeners.add(listener);
  const replayBeforeSeq = remote.nextSeq - 1;
  if (remote.exitEvent) {
    setTimeout(() => listener(remote.exitEvent!), 0);
  }
  return {
    replayBeforeSeq,
    unsubscribe: () => remote.listeners.delete(listener),
  };
}

export function issueRemotePtyTicket(context: HostedAuthContext, ptyId: string) {
  if (!getOwnedRemotePty(context, ptyId)) return null;
  pruneExpiredTickets();
  const ticket = randomBytes(32).toString("hex");
  const expiresAt = Date.now() + TICKET_TTL_MS;
  tickets.set(ticket, {
    ptyId,
    userId: context.userId,
    organizationId: context.organizationId,
    expiresAt,
  });
  return { ticket, expiresAt };
}

export function consumeRemotePtyTicket(
  context: HostedAuthContext,
  ptyId: string,
  ticket: string | null | undefined,
): boolean {
  pruneExpiredTickets();
  const raw = (ticket ?? "").trim();
  if (!raw) return false;
  const entry = tickets.get(raw);
  tickets.delete(raw);
  return !!entry &&
    entry.ptyId === ptyId &&
    entry.userId === context.userId &&
    entry.organizationId === context.organizationId &&
    entry.expiresAt > Date.now() &&
    !!getOwnedRemotePty(context, ptyId);
}

function pruneExpiredTickets() {
  const now = Date.now();
  for (const [ticket, entry] of tickets) {
    if (entry.expiresAt <= now) tickets.delete(ticket);
  }
}
