import { describe, it, expect, vi } from "vitest";
import { SandboxInstance, SandboxRegistry, type RegistryDeps, type AgentCallbacks } from "../sandbox-registry";
import { EXPECTED_SANDBOX_AGENT_VERSION, type SandboxConfig, type SandboxState } from "../sandbox-types";

function config(id: string): SandboxConfig {
  return {
    id,
    kind: "local-docker",
    imageTag: null,
    dockerfilePath: null,
    buildArgs: {},
    env: {},
    gitAuthMode: "none",
    declaredPorts: [],
    hostAgentPort: null,
    portMap: null,
    remoteAgentUrl: null,
    pairingToken: null,
  };
}

function remoteConfig(id: string): SandboxConfig {
  return {
    ...config(id),
    kind: "remote-vm",
    remoteAgentUrl: "wss://agent.example.com/",
    pairingToken: "remote-token",
  };
}

type Harness = {
  deps: RegistryDeps;
  states: (id: string) => string[];
  lastAgentCb: () => AgentCallbacks | null;
  connectCount: () => number;
  setDockerAvailable: (v: boolean) => void;
  setComposeUp: (fn: RegistryDeps["composeUp"]) => void;
  composeDownCalls: () => Array<{ id: string; destroyVolumes: boolean }>;
  setConnectBudgetMs: (ms: number) => void;
};

function harness(): Harness {
  const emitted = new Map<string, string[]>();
  let dockerUp = true;
  let agentCb: AgentCallbacks | null = null;
  let connects = 0;
  let budgetMs = 180_000;
  const downCalls: Array<{ id: string; destroyVolumes: boolean }> = [];
  let composeUp: RegistryDeps["composeUp"] = async () => ({
    ok: true as const,
    hostAgentPort: 19333,
    token: "tok",
  });

  const deps: RegistryDeps = {
    dockerAvailable: async () => dockerUp,
    composeUp: (c, f) => composeUp(c, f),
    composeDown: async (c, destroyVolumes) => {
      downCalls.push({ id: c.id, destroyVolumes });
      return { ok: true };
    },
    connectAgent: (_c, _p, _t, cb) => {
      agentCb = cb;
      connects += 1;
      return { close: () => {} };
    },
    emitState: (id, state: SandboxState) => {
      const arr = emitted.get(id) ?? [];
      arr.push(state.status);
      emitted.set(id, arr);
    },
    connectBudgetMs: () => budgetMs,
  };

  return {
    deps,
    states: (id) => emitted.get(id) ?? [],
    lastAgentCb: () => agentCb,
    connectCount: () => connects,
    setDockerAvailable: (v) => (dockerUp = v),
    setComposeUp: (fn) => (composeUp = fn),
    composeDownCalls: () => downCalls,
    setConnectBudgetMs: (ms) => (budgetMs = ms),
  };
}

describe("SandboxInstance lifecycle", () => {
  it("starts → running → connected when the agent reports a current version", async () => {
    const h = harness();
    const inst = new SandboxInstance(config("sb-1"), h.deps);
    await inst.start();
    h.lastAgentCb()!.onReady(EXPECTED_SANDBOX_AGENT_VERSION, { claude: "2.1" });
    expect(h.states("sb-1")).toEqual(["starting", "running", "connected"]);
    expect(inst.state).toMatchObject({ status: "connected", version: EXPECTED_SANDBOX_AGENT_VERSION });
  });

  it("surfaces update-required on a version mismatch", async () => {
    const h = harness();
    const inst = new SandboxInstance(config("sb-1"), h.deps);
    await inst.start();
    h.lastAgentCb()!.onReady("0.0.1", {});
    expect(inst.state).toMatchObject({ status: "update-required", expectedVersion: EXPECTED_SANDBOX_AGENT_VERSION });
  });

  it("errors when Docker is unavailable", async () => {
    const h = harness();
    h.setDockerAvailable(false);
    const inst = new SandboxInstance(config("sb-1"), h.deps);
    const r = await inst.start();
    expect(r.ok).toBe(false);
    expect(inst.state.status).toBe("error");
  });

  it("connects remote VM sandboxes without requiring Docker or compose", async () => {
    const h = harness();
    h.setDockerAvailable(false);
    const inst = new SandboxInstance(remoteConfig("sb-remote"), h.deps);

    const r = await inst.start();
    h.lastAgentCb()!.onReady(EXPECTED_SANDBOX_AGENT_VERSION, {});

    expect(r.ok).toBe(true);
    expect(h.states("sb-remote")).toEqual(["starting", "running", "connected"]);
    expect(h.composeDownCalls()).toEqual([]);
  });

  it("errors when compose up fails", async () => {
    const h = harness();
    h.setComposeUp(async () => ({ ok: false, error: "boom" }));
    const inst = new SandboxInstance(config("sb-1"), h.deps);
    const r = await inst.start();
    expect(r).toEqual({ ok: false, error: "boom" });
    expect(inst.state.status).toBe("error");
  });

  it("staleness guard: a destroy during compose-up prevents the start from connecting", async () => {
    const h = harness();
    let resolveUp!: (v: { ok: true; hostAgentPort: number; token: string }) => void;
    h.setComposeUp(() => new Promise((res) => (resolveUp = res)));
    const inst = new SandboxInstance(config("sb-1"), h.deps);

    const startP = inst.start();
    await new Promise((r) => setTimeout(r, 0)); // let dockerAvailable resolve → composeUp is now pending
    inst.dispose(); // bumps the op epoch + sets manualStop (no opInFlight gate)
    resolveUp({ ok: true, hostAgentPort: 19333, token: "tok" });
    await startP;

    expect(h.states("sb-1")).not.toContain("running"); // the stale start never advanced
    expect(h.lastAgentCb()).toBeNull(); // connectAgent was never reached
  });

  it("serializes overlapping ops (second start is rejected)", async () => {
    const h = harness();
    h.setComposeUp(() => new Promise(() => {})); // never resolves
    const inst = new SandboxInstance(config("sb-1"), h.deps);
    void inst.start();
    const second = await inst.start();
    expect(second).toEqual({ ok: false, error: "A sandbox operation is already in progress." });
  });

  it("reconnects with backoff when the first agent connect drops (container not ready yet)", async () => {
    vi.useFakeTimers();
    try {
      const h = harness();
      const inst = new SandboxInstance(config("sb-1"), h.deps);
      await inst.start();
      expect(h.connectCount()).toBe(1);

      // First WS attempt fails before `ready` (the classic "socket hang up").
      h.lastAgentCb()!.onClose();
      expect(inst.state.status).toBe("running"); // not stuck dead — awaiting retry
      expect(h.connectCount()).toBe(1);

      await vi.advanceTimersByTimeAsync(1_000); // backoff fires → retry
      expect(h.connectCount()).toBe(2);

      // This time the agent comes up.
      h.lastAgentCb()!.onReady(EXPECTED_SANDBOX_AGENT_VERSION, {});
      expect(inst.state.status).toBe("connected");

      // A clean stop cancels any pending reconnect.
      await inst.stop();
      await vi.advanceTimersByTimeAsync(30_000);
      expect(h.connectCount()).toBe(2); // no further reconnect attempts
    } finally {
      vi.useRealTimers();
    }
  });

  it("gives up after the connect budget is exceeded", async () => {
    vi.useFakeTimers();
    try {
      const h = harness();
      h.setConnectBudgetMs(5_000);
      const inst = new SandboxInstance(remoteConfig("sb-remote"), h.deps);
      await inst.start();

      while (inst.state.status !== "error") {
        h.lastAgentCb()!.onClose();
        await vi.advanceTimersByTimeAsync(15_000);
      }

      expect(inst.state).toMatchObject({
        status: "error",
        message: expect.stringMatching(/Couldn't connect to the remote agent after 5s/i),
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("fails fast on auth errors without waiting for the connect budget", async () => {
    const h = harness();
    const inst = new SandboxInstance(remoteConfig("sb-remote"), h.deps);
    await inst.start();
    h.lastAgentCb()!.onError?.(new Error("Unexpected server response: 401"));
    expect(inst.state).toMatchObject({
      status: "error",
      message: expect.stringMatching(/Invalid API key/i),
    });
  });

  it("retryConnect resets the budget and tries again", async () => {
    vi.useFakeTimers();
    try {
      const h = harness();
      h.setConnectBudgetMs(1_000);
      const inst = new SandboxInstance(remoteConfig("sb-remote"), h.deps);
      await inst.start();
      h.lastAgentCb()!.onClose();
      await vi.advanceTimersByTimeAsync(2_000);
      expect(inst.state.status).toBe("error");

      const retry = await inst.retryConnect();
      expect(retry).toEqual({ ok: true });
      expect(inst.state.status).toBe("running");
      expect(h.connectCount()).toBe(2);

      h.lastAgentCb()!.onReady(EXPECTED_SANDBOX_AGENT_VERSION, {});
      expect(inst.state.status).toBe("connected");
    } finally {
      vi.useRealTimers();
    }
  });

  it("rebuild stops then starts with force", async () => {
    const h = harness();
    const forces: boolean[] = [];
    h.setComposeUp(async (_c, f) => {
      forces.push(f);
      return { ok: true, hostAgentPort: 19333, token: "tok" };
    });
    const inst = new SandboxInstance(config("sb-1"), h.deps);
    await inst.start();
    await inst.rebuild();
    expect(forces).toEqual([false, true]); // initial start, then forced rebuild
    expect(h.composeDownCalls().some((c) => !c.destroyVolumes)).toBe(true);
  });
});

describe("SandboxRegistry", () => {
  it("keeps per-sandbox state isolated", async () => {
    const h = harness();
    const reg = new SandboxRegistry(h.deps);
    await reg.start(config("sb-a"));
    await reg.start(config("sb-b"));
    expect(reg.allStates().map((s) => s.sandboxId).sort()).toEqual(["sb-a", "sb-b"]);
    expect(reg.getState("sb-a")!.status).toBe("running");
    expect(reg.getState("sb-b")!.status).toBe("running");
  });

  it("destroy tears down with volume removal and drops the instance", async () => {
    const h = harness();
    const reg = new SandboxRegistry(h.deps);
    await reg.start(config("sb-x"));
    await reg.destroy(config("sb-x"));
    expect(h.composeDownCalls()).toContainEqual({ id: "sb-x", destroyVolumes: true });
    expect(reg.get("sb-x")).toBeNull();
  });

  it("reconcile starts every enabled sandbox and disposes removed ones", async () => {
    const h = harness();
    const reg = new SandboxRegistry(h.deps);
    await reg.reconcile([config("sb-1"), config("sb-2")]);
    expect(reg.getState("sb-1")!.status).toBe("running");
    expect(reg.getState("sb-2")!.status).toBe("running");
    // sb-2 removed from the set → dropped on next reconcile.
    await reg.reconcile([config("sb-1")]);
    expect(reg.get("sb-2")).toBeNull();
    expect(reg.get("sb-1")).not.toBeNull();
  });
});
