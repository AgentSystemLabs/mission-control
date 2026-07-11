import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PtyOutputBatcher,
  resetPtyStreamVisibilityForTests,
  setPtyStreamHidden,
  setPtyStreamPowerSave,
} from "../pty-output-batch";

type Emitted = { ptyId: string; data: string; seq: number };

function makeBatcher() {
  const emitted: Emitted[] = [];
  const batcher = new PtyOutputBatcher((ptyId, data, seq) => {
    emitted.push({ ptyId, data, seq });
  });
  return { batcher, emitted };
}

describe("PtyOutputBatcher", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetPtyStreamVisibilityForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("coalesces chunks within a flush window into one message carrying the last seq", () => {
    const { batcher, emitted } = makeBatcher();
    batcher.push("pty-1", 1, "a");
    batcher.push("pty-1", 2, "b");
    batcher.push("pty-1", 3, "c");
    expect(emitted).toEqual([]);
    vi.advanceTimersByTime(16);
    expect(emitted).toEqual([{ ptyId: "pty-1", data: "abc", seq: 3 }]);
  });

  it("keeps per-pty batches independent and ordered", () => {
    const { batcher, emitted } = makeBatcher();
    batcher.push("pty-1", 1, "one");
    batcher.push("pty-2", 5, "two");
    vi.advanceTimersByTime(16);
    expect(emitted).toEqual([
      { ptyId: "pty-1", data: "one", seq: 1 },
      { ptyId: "pty-2", data: "two", seq: 5 },
    ]);
  });

  it("flush(ptyId) delivers pending output immediately and exactly once", () => {
    const { batcher, emitted } = makeBatcher();
    batcher.push("pty-1", 1, "a");
    batcher.flush("pty-1");
    expect(emitted).toEqual([{ ptyId: "pty-1", data: "a", seq: 1 }]);
    // The scheduled timer must not double-deliver.
    vi.advanceTimersByTime(1000);
    expect(emitted).toHaveLength(1);
  });

  it("flush of an unknown or empty pty is a no-op", () => {
    const { batcher, emitted } = makeBatcher();
    batcher.flush("nope");
    expect(emitted).toEqual([]);
  });

  it("chunks pushed after a flush land in a fresh batch (replay snapshot boundary)", () => {
    const { batcher, emitted } = makeBatcher();
    batcher.push("pty-1", 1, "pre");
    batcher.flush("pty-1"); // snapshot taken here at nextSeq=2
    batcher.push("pty-1", 2, "post");
    vi.advanceTimersByTime(16);
    expect(emitted).toEqual([
      { ptyId: "pty-1", data: "pre", seq: 1 },
      { ptyId: "pty-1", data: "post", seq: 2 },
    ]);
  });

  it("force-flushes mid-interval once the pending batch is large", () => {
    const { batcher, emitted } = makeBatcher();
    batcher.push("pty-1", 1, "x".repeat(262_144));
    expect(emitted).toHaveLength(1);
    expect(emitted[0]!.data).toHaveLength(262_144);
  });

  it("slows the flush interval while the stream is hidden", () => {
    const { batcher, emitted } = makeBatcher();
    setPtyStreamHidden(true);
    batcher.push("pty-1", 1, "a");
    vi.advanceTimersByTime(16);
    expect(emitted).toEqual([]);
    vi.advanceTimersByTime(984);
    expect(emitted).toEqual([{ ptyId: "pty-1", data: "a", seq: 1 }]);
  });

  it("flushes every pending batch the moment the stream becomes visible", () => {
    const { batcher, emitted } = makeBatcher();
    setPtyStreamHidden(true);
    batcher.push("pty-1", 1, "a");
    batcher.push("pty-2", 2, "b");
    setPtyStreamHidden(false);
    expect(emitted).toEqual([
      { ptyId: "pty-1", data: "a", seq: 1 },
      { ptyId: "pty-2", data: "b", seq: 2 },
    ]);
  });

  it("battery saver slows non-interactive ptys but keeps interactive ones real-time", () => {
    const { batcher, emitted } = makeBatcher();
    setPtyStreamPowerSave(true);
    batcher.push("idle", 1, "spinner");
    batcher.push("typing", 1, "echo", true);
    vi.advanceTimersByTime(16);
    // The terminal being typed into flushed on the fast cadence…
    expect(emitted).toEqual([{ ptyId: "typing", data: "echo", seq: 1 }]);
    // …the background one waits for the saver interval.
    vi.advanceTimersByTime(234);
    expect(emitted).toEqual([
      { ptyId: "typing", data: "echo", seq: 1 },
      { ptyId: "idle", data: "spinner", seq: 1 },
    ]);
  });

  it("hidden window outranks battery saver for the flush interval", () => {
    const { batcher, emitted } = makeBatcher();
    setPtyStreamPowerSave(true);
    setPtyStreamHidden(true);
    batcher.push("idle", 1, "x", true);
    vi.advanceTimersByTime(250);
    expect(emitted).toEqual([]);
    vi.advanceTimersByTime(750);
    expect(emitted).toHaveLength(1);
  });

  it("dispose flushes remaining output and detaches from visibility events", () => {
    const { batcher, emitted } = makeBatcher();
    setPtyStreamHidden(true);
    batcher.push("pty-1", 1, "tail");
    batcher.dispose();
    expect(emitted).toEqual([{ ptyId: "pty-1", data: "tail", seq: 1 }]);
    // No longer subscribed: visibility flips don't touch the disposed batcher.
    setPtyStreamHidden(false);
    expect(emitted).toHaveLength(1);
  });
});
