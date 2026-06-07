import { describe, it, expect, vi } from "vitest";
import { SandboxInstance, SandboxRegistry, type RegistryDeps, type AgentCallbacks } from "../sandbox-registry";
import { EXPECTED_SANDBOX_AGENT_VERSION, type SandboxConfig, type SandboxState } from "../sandbox-types";

function config(id: string): SandboxConfig {
  return {
    id,
    kind: "remote-vm",
    imageTag: null,
    dockerfilePath: null,
    buildArgs: {},
    env: {},
    gitAuthMode: "none",
    copyAgentCreds: false,
    declaredPorts: [],
    hostAgentPort: null,
    portMap: null,
    remoteAgentUrl: "wss://agent.example.com/",
    pairingToken: "remote-token",
    remoteAgentCa: null,
    remoteStatus: null,
    remoteProvider: null,
  };
}

type Harness = {
  deps: RegistryDeps;
  states: (id: string) => string[];
  lastAgentCb: () => AgentCallbacks | null;
  connectCount: () => number;
  setConnectBudgetMs: (ms: number) => void;
};

function harness(): Harness {
  const emitted = new Map<string, string[]>();
  let agentCb: AgentCallbacks | null = null;
  let connects = 0;
  let budgetMs = 180_000;

  const deps: RegistryDeps = {
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

  it("errors when the remote agent URL or API key is missing", async () => {
    const h = harness();
    const inst = new SandboxInstance({ ...config("sb-1"), remoteAgentUrl: null }, h.deps);
    const r = await inst.start();
    expect(r.ok).toBe(false);
    expect(inst.state.status).toBe("error");
    expect(h.connectCount()).toBe(0);
  });

  it("does not connect a paused remote VM sandbox", async () => {
    const h = harness();
    const paused = { ...config("sb-remote"), remoteStatus: "paused" };
    const inst = new SandboxInstance(paused, h.deps);

    const r = await inst.start();

    expect(r.ok).toBe(false);
    expect(inst.state).toMatchObject({ status: "stopped" });
    expect(h.connectCount()).toBe(0);
  });

  it("staleness guard: a dispose during start prevents a stale reconnect from connecting", async () => {
    vi.useFakeTimers();
    try {
      const h = harness();
      const inst = new SandboxInstance(config("sb-1"), h.deps);
      await inst.start();
      expect(h.connectCount()).toBe(1);

      // The first connect drops; a reconnect is scheduled.
      h.lastAgentCb()!.onClose();
      inst.dispose(); // bumps the op epoch + sets manualStop
      await vi.advanceTimersByTimeAsync(30_000);

      expect(h.connectCount()).toBe(1); // the stale reconnect never fired
    } finally {
      vi.useRealTimers();
    }
  });

  it("reconnects with backoff when the first agent connect drops (agent not ready yet)", async () => {
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
      const inst = new SandboxInstance(config("sb-remote"), h.deps);
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
    const inst = new SandboxInstance(config("sb-remote"), h.deps);
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
      const inst = new SandboxInstance(config("sb-remote"), h.deps);
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

  it("rebuild stops then starts again", async () => {
    const h = harness();
    const inst = new SandboxInstance(config("sb-1"), h.deps);
    await inst.start();
    h.lastAgentCb()!.onReady(EXPECTED_SANDBOX_AGENT_VERSION, {});
    await inst.rebuild();
    expect(inst.state.status).toBe("running");
    expect(h.connectCount()).toBe(2); // initial start, then rebuild reconnect
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

  it("destroy drops the instance", async () => {
    const h = harness();
    const reg = new SandboxRegistry(h.deps);
    await reg.start(config("sb-x"));
    const r = await reg.destroy(config("sb-x"));
    expect(r.ok).toBe(true);
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
