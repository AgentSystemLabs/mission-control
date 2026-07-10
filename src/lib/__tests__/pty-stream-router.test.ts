import { describe, expect, it } from "vitest";
import {
  createPtyStreamRouter,
  getPtyStreamRouter,
  type PtyDataMsg,
  type PtyExitMsg,
  type PtyStreamTransport,
} from "../pty-stream-router";

function makeTransport() {
  const dataCbs: Array<(msg: PtyDataMsg) => void> = [];
  const exitCbs: Array<(msg: PtyExitMsg) => void> = [];
  const transport: PtyStreamTransport = {
    onData: (cb) => {
      dataCbs.push(cb);
      return () => undefined;
    },
    onExit: (cb) => {
      exitCbs.push(cb);
      return () => undefined;
    },
  };
  return {
    transport,
    emitData: (msg: PtyDataMsg) => dataCbs.forEach((cb) => cb(msg)),
    emitExit: (msg: PtyExitMsg) => exitCbs.forEach((cb) => cb(msg)),
    listenerCount: () => dataCbs.length + exitCbs.length,
  };
}

describe("pty-stream-router", () => {
  it("subscribes to the transport exactly once regardless of claims", () => {
    const t = makeTransport();
    const router = createPtyStreamRouter(t.transport);
    router.claim("a", { data: () => undefined, exit: () => undefined });
    router.claim("b", { data: () => undefined, exit: () => undefined });
    expect(t.listenerCount()).toBe(2); // one onData + one onExit
  });

  it("routes data and exit to the claiming handlers only", () => {
    const t = makeTransport();
    const router = createPtyStreamRouter(t.transport);
    const got: string[] = [];
    router.claim("a", {
      data: (msg) => got.push(`a-data:${msg.data}`),
      exit: (msg) => got.push(`a-exit:${msg.exitCode}`),
    });
    router.claim("b", {
      data: (msg) => got.push(`b-data:${msg.data}`),
      exit: () => got.push("b-exit"),
    });
    t.emitData({ ptyId: "a", data: "x", seq: 1 });
    t.emitData({ ptyId: "b", data: "y", seq: 1 });
    t.emitExit({ ptyId: "a", exitCode: 0 });
    expect(got).toEqual(["a-data:x", "b-data:y", "a-exit:0"]);
  });

  it("buffers unclaimed output and hands it over once, in order", () => {
    const t = makeTransport();
    const router = createPtyStreamRouter(t.transport);
    t.emitData({ ptyId: "new", data: "hel", seq: 1 });
    t.emitData({ ptyId: "new", data: "lo", seq: 2 });
    const pending = router.takePendingData("new");
    expect(pending.map((c) => c.data).join("")).toBe("hello");
    expect(pending.map((c) => c.seq)).toEqual([1, 2]);
    expect(router.takePendingData("new")).toEqual([]);
  });

  it("buffers an unclaimed exit and hands it over once", () => {
    const t = makeTransport();
    const router = createPtyStreamRouter(t.transport);
    t.emitExit({ ptyId: "gone", exitCode: 137, signal: 9 });
    expect(router.takePendingExit("gone")).toEqual({ ptyId: "gone", exitCode: 137, signal: 9 });
    expect(router.takePendingExit("gone")).toBeNull();
  });

  it("stops buffering once claimed and resumes when unclaimed", () => {
    const t = makeTransport();
    const router = createPtyStreamRouter(t.transport);
    const got: string[] = [];
    const unclaim = router.claim("a", {
      data: (msg) => got.push(msg.data),
      exit: () => undefined,
    });
    t.emitData({ ptyId: "a", data: "live", seq: 1 });
    expect(got).toEqual(["live"]);
    expect(router.takePendingData("a")).toEqual([]);
    unclaim();
    t.emitData({ ptyId: "a", data: "buffered", seq: 2 });
    expect(got).toEqual(["live"]);
    expect(router.takePendingData("a").map((c) => c.data)).toEqual(["buffered"]);
  });

  it("a stale unclaim cannot detach a successor claim", () => {
    const t = makeTransport();
    const router = createPtyStreamRouter(t.transport);
    const got: string[] = [];
    const unclaimOld = router.claim("a", { data: () => got.push("old"), exit: () => undefined });
    router.claim("a", { data: () => got.push("new"), exit: () => undefined });
    unclaimOld(); // tears down the OLD claim's handle only — the new claim stays
    t.emitData({ ptyId: "a", data: "x", seq: 1 });
    expect(got).toEqual(["new"]);
  });

  it("bounds buffered output per pty", () => {
    const t = makeTransport();
    const router = createPtyStreamRouter(t.transport);
    t.emitData({ ptyId: "a", data: "x".repeat(64_000), seq: 1 });
    t.emitData({ ptyId: "a", data: "tail", seq: 2 });
    // Oldest chunk dropped to stay under the cap; the newest survives.
    expect(router.takePendingData("a").map((c) => c.seq)).toEqual([2]);
  });

  it("evicts the oldest unclaimed ptys beyond the cap", () => {
    const t = makeTransport();
    const router = createPtyStreamRouter(t.transport);
    for (let i = 0; i < 70; i += 1) {
      t.emitData({ ptyId: `pty-${i}`, data: "x", seq: 1 });
    }
    expect(router.takePendingData("pty-0")).toEqual([]);
    expect(router.takePendingData("pty-69").map((c) => c.data)).toEqual(["x"]);
  });

  it("getPtyStreamRouter returns the same router per transport", () => {
    const t1 = makeTransport();
    const t2 = makeTransport();
    expect(getPtyStreamRouter(t1.transport)).toBe(getPtyStreamRouter(t1.transport));
    expect(getPtyStreamRouter(t1.transport)).not.toBe(getPtyStreamRouter(t2.transport));
    expect(t1.listenerCount()).toBe(2);
  });
});
