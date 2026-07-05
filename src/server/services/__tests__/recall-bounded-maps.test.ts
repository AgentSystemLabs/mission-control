import { afterEach, describe, expect, it } from "vitest";
import { sweepStaleCooldowns } from "../_cooldowns";
import {
  __resetTranscriptPaths,
  getTranscriptPath,
  setTranscriptPath,
} from "../session-transcripts";

describe("sweepStaleCooldowns", () => {
  it("drops entries older than 10× the window and keeps recent ones", () => {
    const map = new Map<string, number>();
    const windowMs = 1_000;
    const now = 100_000;
    map.set("ancient", now - windowMs * 11);
    map.set("recent", now - windowMs * 2);
    map.set("fresh", now);
    sweepStaleCooldowns(map, now, windowMs);
    expect(map.has("ancient")).toBe(false);
    expect(map.has("recent")).toBe(true);
    expect(map.has("fresh")).toBe(true);
  });
});

describe("session transcript path map", () => {
  afterEach(() => __resetTranscriptPaths());

  it("evicts the oldest-inserted task past the cap", () => {
    for (let i = 0; i < 501; i++) {
      setTranscriptPath(`task-${i}`, `/tmp/transcript-${i}.jsonl`);
    }
    expect(getTranscriptPath("task-0")).toBeUndefined();
    expect(getTranscriptPath("task-1")).toBe("/tmp/transcript-1.jsonl");
    expect(getTranscriptPath("task-500")).toBe("/tmp/transcript-500.jsonl");
  });

  it("refreshes recency when a task's path is re-reported", () => {
    for (let i = 0; i < 500; i++) {
      setTranscriptPath(`task-${i}`, `/tmp/t-${i}.jsonl`);
    }
    // task-0 reports again → becomes most recent, so task-1 is evicted instead.
    setTranscriptPath("task-0", "/tmp/t-0-again.jsonl");
    setTranscriptPath("task-new", "/tmp/t-new.jsonl");
    expect(getTranscriptPath("task-0")).toBe("/tmp/t-0-again.jsonl");
    expect(getTranscriptPath("task-1")).toBeUndefined();
  });
});
