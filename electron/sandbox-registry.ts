import {
  EXPECTED_SANDBOX_AGENT_VERSION,
  isSandboxAgentVersionCurrent,
  type OpResult,
  type SandboxConfig,
  type SandboxState,
  type ScopedSandboxState,
} from "./sandbox-types";

// Phase 2 core: one container + agent connection per sandbox, all running
// concurrently. This module owns the per-sandbox state machine + the staleness
// guard that makes start/stop/rebuild safe to interleave. Docker + agent I/O are
// injected (RegistryDeps) so the logic is unit-testable without Docker; the live
// wiring lives in the manager. See docs/multi-sandbox-plan.md §5.

export type AgentCallbacks = {
  onReady: (version: string, agents: Record<string, string | null>) => void;
  onClose: () => void;
};

export type AgentHandle = { close: () => void };

export type RegistryDeps = {
  dockerAvailable: () => Promise<boolean>;
  /** Build (if needed) + compose up; resolves the host agent port + pairing token. */
  composeUp: (
    config: SandboxConfig,
    force: boolean,
  ) => Promise<{ ok: true; hostAgentPort: number; token: string } | { ok: false; error: string }>;
  /** Compose down. destroyVolumes wipes the sandbox's data ("destroy everything"). */
  composeDown: (config: SandboxConfig, destroyVolumes: boolean) => Promise<OpResult>;
  /** Open the agent WS for a running container/remote VM; invokes callbacks; returns a handle. */
  connectAgent: (
    config: SandboxConfig,
    agentUrl: string,
    token: string,
    cb: AgentCallbacks,
  ) => AgentHandle;
  /** Push a state change to the renderer, tagged with the sandbox id. */
  emitState: (sandboxId: string, state: SandboxState) => void;
};

const DOCKER_DOWN_ERROR = "Docker isn't running. Start Docker Desktop / the Docker daemon and try again.";
const REMOTE_CONFIG_ERROR = "Remote sandbox is missing an agent URL or API key.";
const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 15_000;

export class SandboxInstance {
  readonly id: string;
  private config: SandboxConfig;
  private readonly deps: RegistryDeps;
  private _state: SandboxState = { status: "stopped", dockerAvailable: false };
  private agent: AgentHandle | null = null;
  // Bumped on every start/stop/destroy so an in-flight async tail (a slow
  // `compose up`) or a late agent callback can detect it's been superseded.
  private opEpoch = 0;
  private opInFlight = false;
  private manualStop = false;
  // A freshly-started container's mc-agent takes a few seconds to listen, so the
  // first WS connect often fails ("socket hang up"). Retry with backoff until it's
  // up. Last successful URL/token are kept so a reconnect targets the same agent.
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private lastAgentUrl: string | null = null;
  private lastToken: string | null = null;

  constructor(config: SandboxConfig, deps: RegistryDeps) {
    this.id = config.id;
    this.config = config;
    this.deps = deps;
  }

  get state(): SandboxState {
    return this._state;
  }

  /** Adopt the latest persisted config (image/ports/env may have changed). */
  updateConfig(config: SandboxConfig): void {
    this.config = config;
  }

  private get hasAgent(): boolean {
    return this._state.status === "connected" || this._state.status === "update-required";
  }

  private set(next: SandboxState): void {
    this._state = next;
    this.deps.emitState(this.id, next);
  }

  async start(force = false): Promise<OpResult> {
    if (this.opInFlight) return { ok: false, error: "A sandbox operation is already in progress." };
    this.opInFlight = true;
    const epoch = ++this.opEpoch;
    this.manualStop = false;
    try {
      let agentUrl: string;
      let token: string;
      if (this.config.kind === "remote-vm") {
        if (!this.config.remoteAgentUrl || !this.config.pairingToken) {
          this.set({ status: "error", message: REMOTE_CONFIG_ERROR });
          return { ok: false, error: REMOTE_CONFIG_ERROR };
        }
        this.set({ status: "starting", step: "connecting to remote agent" });
        agentUrl = this.config.remoteAgentUrl;
        token = this.config.pairingToken;
      } else {
        if (!(await this.deps.dockerAvailable())) {
          this.set({ status: "error", message: DOCKER_DOWN_ERROR });
          return { ok: false, error: DOCKER_DOWN_ERROR };
        }
        this.set({ status: "starting", step: force ? "rebuilding image" : "starting container" });
        const up = await this.deps.composeUp(this.config, force);
        if (!up.ok) {
          if (this.isStale(epoch)) return { ok: true };
          this.set({ status: "error", message: up.error });
          return up;
        }
        agentUrl = `ws://127.0.0.1:${up.hostAgentPort}/`;
        token = up.token;
      }
      // A stop / destroy / newer start landed while the (possibly long) compose
      // ran — don't clobber that newer state or start connecting.
      if (this.isStale(epoch)) return { ok: true };
      this.set({ status: "running" });
      this.lastAgentUrl = agentUrl;
      this.lastToken = token;
      this.reconnectAttempts = 0;
      this.connect(agentUrl, token, epoch);
      return { ok: true };
    } finally {
      this.opInFlight = false;
    }
  }

  private isStale(epoch: number): boolean {
    return epoch !== this.opEpoch || this.manualStop;
  }

  private connect(agentUrl: string, token: string, epoch: number): void {
    this.closeAgent();
    const handle = this.deps.connectAgent(this.config, agentUrl, token, {
      onReady: (version, agents) => {
        if (this.agent !== handle || this.manualStop || epoch !== this.opEpoch) return;
        this.reconnectAttempts = 0; // connected — reset backoff
        if (isSandboxAgentVersionCurrent(version)) {
          this.set({ status: "connected", version, agents });
        } else {
          this.set({
            status: "update-required",
            version,
            expectedVersion: EXPECTED_SANDBOX_AGENT_VERSION,
            agents,
          });
        }
      },
      onClose: () => {
        if (this.agent === handle) this.agent = null;
        if (this.manualStop || epoch !== this.opEpoch) return;
        if (this.hasAgent || this._state.status === "running") this.set({ status: "running" });
        // The container is up but the agent dropped / wasn't ready — keep retrying.
        this.scheduleReconnect(epoch);
      },
    });
    this.agent = handle;
  }

  private scheduleReconnect(epoch: number): void {
    if (this.reconnectTimer || this.manualStop || epoch !== this.opEpoch) return;
    if (!this.lastAgentUrl || !this.lastToken) return;
    const delay = Math.min(RECONNECT_BASE_MS * 2 ** this.reconnectAttempts, RECONNECT_MAX_MS);
    this.reconnectAttempts += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.manualStop || epoch !== this.opEpoch) return;
      this.connect(this.lastAgentUrl!, this.lastToken!, epoch);
    }, delay);
  }

  private clearReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private closeAgent(): void {
    const old = this.agent;
    this.agent = null;
    old?.close();
  }

  async stop(): Promise<OpResult> {
    if (this.opInFlight) return { ok: false, error: "A sandbox operation is already in progress." };
    this.opInFlight = true;
    this.opEpoch += 1;
    this.manualStop = true;
    this.clearReconnect();
    try {
      this.closeAgent();
      if (this.config.kind === "local-docker") {
        const r = await this.deps.composeDown(this.config, false);
        if (!r.ok) {
          this.set({ status: "error", message: r.error });
          return r;
        }
      }
      this.set({ status: "stopped", dockerAvailable: true });
      return { ok: true };
    } finally {
      this.opInFlight = false;
    }
  }

  async rebuild(): Promise<OpResult> {
    const stopped = await this.stop();
    if (!stopped.ok) return stopped;
    return this.start(true);
  }

  /** Stop + remove volumes (and never reconnect). Used by sandbox deletion. */
  async destroy(): Promise<OpResult> {
    this.opEpoch += 1;
    this.manualStop = true;
    this.clearReconnect();
    this.closeAgent();
    if (this.config.kind === "remote-vm") return { ok: true };
    return this.deps.composeDown(this.config, true);
  }

  /** Detach without touching Docker (app quit). */
  dispose(): void {
    this.opEpoch += 1;
    this.manualStop = true;
    this.clearReconnect();
    this.closeAgent();
  }
}

export class SandboxRegistry {
  private readonly instances = new Map<string, SandboxInstance>();
  private readonly deps: RegistryDeps;

  constructor(deps: RegistryDeps) {
    this.deps = deps;
  }

  private ensure(config: SandboxConfig): SandboxInstance {
    const existing = this.instances.get(config.id);
    if (existing) {
      existing.updateConfig(config);
      return existing;
    }
    const created = new SandboxInstance(config, this.deps);
    this.instances.set(config.id, created);
    return created;
  }

  get(id: string): SandboxInstance | null {
    return this.instances.get(id) ?? null;
  }

  getState(id: string): SandboxState | null {
    return this.instances.get(id)?.state ?? null;
  }

  allStates(): ScopedSandboxState[] {
    return [...this.instances.values()].map((i) => ({ sandboxId: i.id, state: i.state }));
  }

  start(config: SandboxConfig, force = false): Promise<OpResult> {
    return this.ensure(config).start(force);
  }

  stop(id: string): Promise<OpResult> {
    return this.instances.get(id)?.stop() ?? Promise.resolve({ ok: false, error: "unknown sandbox" });
  }

  rebuild(config: SandboxConfig): Promise<OpResult> {
    return this.ensure(config).rebuild();
  }

  async destroy(config: SandboxConfig): Promise<OpResult> {
    const inst = this.ensure(config);
    const r = await inst.destroy();
    this.instances.delete(config.id);
    return r;
  }

  /**
   * "Keep all running": start every enabled sandbox that isn't already up, and
   * drop instances for sandboxes that no longer exist. Idempotent — safe to call
   * on launch and after any sandbox CRUD.
   */
  async reconcile(configs: SandboxConfig[]): Promise<void> {
    const present = new Set(configs.map((c) => c.id));
    for (const [id, inst] of this.instances) {
      if (!present.has(id)) {
        inst.dispose();
        this.instances.delete(id);
      }
    }
    await Promise.all(
      configs.map((c) => {
        const inst = this.ensure(c);
        const s = inst.state.status;
        return s === "stopped" || s === "error" || s === "disabled"
          ? inst.start()
          : Promise.resolve<OpResult>({ ok: true });
      }),
    );
  }

  disposeAll(): void {
    for (const inst of this.instances.values()) inst.dispose();
    this.instances.clear();
  }
}
