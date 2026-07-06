import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Terminal } from "@xterm/xterm";
import { createTerminalGpuLease, resetTerminalWebglForTests } from "../terminal-webgl";

// The lease manager loads the addon via dynamic import; swap in a fake that
// records instances so tests can count live contexts and fire context loss.
const addonInstances: FakeWebglAddon[] = [];
class FakeWebglAddon {
  disposed = false;
  contextLossCb: (() => void) | null = null;
  constructor() {
    addonInstances.push(this);
  }
  onContextLoss(cb: () => void) {
    this.contextLossCb = cb;
  }
  dispose() {
    this.disposed = true;
  }
}
vi.mock("@xterm/addon-webgl", () => ({ WebglAddon: FakeWebglAddon }));

function fakeTerm() {
  return { loadAddon: vi.fn() } as unknown as Terminal;
}

/** Flush the async attach path (support check + addon import). */
async function flush() {
  await vi.dynamicImportSettled();
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
}

function liveAddons() {
  return addonInstances.filter((a) => !a.disposed);
}

beforeEach(() => {
  resetTerminalWebglForTests();
  addonInstances.length = 0;
  // node env has no document; provide one that reports WebGL2 support.
  vi.stubGlobal("document", {
    createElement: () => ({
      getContext: () => ({ getExtension: () => null }),
    }),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createTerminalGpuLease", () => {
  it("attaches a webgl addon to the terminal", async () => {
    const term = fakeTerm();
    const lease = createTerminalGpuLease(term);
    lease.attach();
    await flush();
    expect(term.loadAddon).toHaveBeenCalledTimes(1);
    expect(liveAddons()).toHaveLength(1);
  });

  it("is a no-op when WebGL is unavailable", async () => {
    vi.stubGlobal("document", {
      createElement: () => ({ getContext: () => null }),
    });
    const term = fakeTerm();
    const lease = createTerminalGpuLease(term);
    lease.attach();
    await flush();
    expect(term.loadAddon).not.toHaveBeenCalled();
  });

  it("caps concurrent GPU terminals and evicts parked contexts under pressure", async () => {
    const leases = Array.from({ length: 13 }, () => createTerminalGpuLease(fakeTerm()));
    for (const lease of leases.slice(0, 12)) {
      lease.attach();
      await flush();
    }
    expect(liveAddons()).toHaveLength(12);

    // Every slot is held by an on-screen terminal: the 13th attach gets nothing.
    leases[12]!.attach();
    await flush();
    expect(addonInstances).toHaveLength(12);

    // Park one → its context is retained for the grace period, still counted…
    leases[0]!.detach();
    expect(liveAddons()).toHaveLength(12);

    // …but an on-screen terminal needing the slot evicts the parked context.
    const lease13 = createTerminalGpuLease(fakeTerm());
    lease13.attach();
    await flush();
    expect(liveAddons()).toHaveLength(12);
    expect(addonInstances[0]!.disposed).toBe(true);
  });

  it("re-attach within the grace period reuses the retained context", async () => {
    const lease = createTerminalGpuLease(fakeTerm());
    lease.attach();
    await flush();
    lease.detach();
    expect(liveAddons()).toHaveLength(1); // retained while parked
    lease.attach();
    await flush();
    expect(liveAddons()).toHaveLength(1);
    // Reused, not re-created — and a redundant attach must not stack addons.
    lease.attach();
    await flush();
    expect(addonInstances).toHaveLength(1);
  });

  it("releases a parked context once the grace period lapses", async () => {
    vi.useFakeTimers();
    try {
      const lease = createTerminalGpuLease(fakeTerm());
      lease.attach();
      await flush();
      lease.detach();
      expect(liveAddons()).toHaveLength(1);
      vi.advanceTimersByTime(30_000);
      expect(liveAddons()).toHaveLength(0);
      // A later attach builds a fresh context (no double-counting).
      lease.attach();
      await flush();
      expect(liveAddons()).toHaveLength(1);
      expect(addonInstances).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("frees the slot when the GPU context is lost", async () => {
    const leaseA = createTerminalGpuLease(fakeTerm());
    leaseA.attach();
    await flush();
    addonInstances[0]!.contextLossCb?.();
    expect(liveAddons()).toHaveLength(0);

    const leaseB = createTerminalGpuLease(fakeTerm());
    leaseB.attach();
    await flush();
    expect(liveAddons()).toHaveLength(1);
  });

  it("a detach that races the async attach wins", async () => {
    const term = fakeTerm();
    const lease = createTerminalGpuLease(term);
    lease.attach();
    lease.detach(); // parked before the addon import resolved
    await flush();
    expect(term.loadAddon).not.toHaveBeenCalled();
  });

  it("dispose is terminal — later attach is ignored", async () => {
    const term = fakeTerm();
    const lease = createTerminalGpuLease(term);
    lease.attach();
    await flush();
    lease.dispose();
    expect(liveAddons()).toHaveLength(0);
    lease.attach();
    await flush();
    expect(liveAddons()).toHaveLength(0);
  });
});
