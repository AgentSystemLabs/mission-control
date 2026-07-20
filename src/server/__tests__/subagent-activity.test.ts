import { afterEach, describe, expect, it, vi } from "vitest";
import {
  armDeferredFinish,
  clearSubagentActivity,
  disarmDeferredFinish,
  hasActiveSubagents,
  noteSubagentStart,
  noteSubagentStop,
} from "../services/subagent-activity";

const TTL_MS = 2 * 60 * 60 * 1000;
const RECHECK_MS = 60 * 1000;

const realNow = Date.now;

afterEach(() => {
  Date.now = realNow;
  vi.useRealTimers();
});

describe("subagent activity tracking", () => {
  it("tracks start/stop pairs by agent id", () => {
    const taskId = "task-pairs";
    expect(hasActiveSubagents(taskId)).toBe(false);

    noteSubagentStart(taskId, "a");
    noteSubagentStart(taskId, "b");
    expect(hasActiveSubagents(taskId)).toBe(true);

    noteSubagentStop(taskId, "a");
    expect(hasActiveSubagents(taskId)).toBe(true);
    noteSubagentStop(taskId, "b");
    expect(hasActiveSubagents(taskId)).toBe(false);
  });

  it("is idempotent for repeated stops of the same subagent", () => {
    const taskId = "task-idempotent";
    noteSubagentStart(taskId, "a");
    // A resumed subagent can stop more than once; repeats must not underflow
    // and mask another still-active subagent.
    noteSubagentStop(taskId, "a");
    noteSubagentStop(taskId, "a");
    noteSubagentStart(taskId, "b");
    noteSubagentStop(taskId, "a");
    expect(hasActiveSubagents(taskId)).toBe(true);
    noteSubagentStop(taskId, "b");
    expect(hasActiveSubagents(taskId)).toBe(false);
  });

  it("floors the anonymous count at zero", () => {
    const taskId = "task-anon";
    noteSubagentStop(taskId, undefined);
    expect(hasActiveSubagents(taskId)).toBe(false);

    noteSubagentStart(taskId, undefined);
    noteSubagentStart(taskId, undefined);
    noteSubagentStop(taskId, undefined);
    expect(hasActiveSubagents(taskId)).toBe(true);
    noteSubagentStop(taskId, undefined);
    expect(hasActiveSubagents(taskId)).toBe(false);
  });

  it("expires stale entries so a lost SubagentStop cannot hold a task forever", () => {
    const taskId = "task-ttl";
    noteSubagentStart(taskId, "lost");
    noteSubagentStart(taskId, undefined);
    expect(hasActiveSubagents(taskId)).toBe(true);

    // Beyond the 2h TTL: the never-stopped entries stop counting as active.
    Date.now = () => realNow() + TTL_MS + 1;
    expect(hasActiveSubagents(taskId)).toBe(false);
  });

  it("cross-cancels mismatched keyed/anonymous start-stop pairs", () => {
    // Keyed start, anonymous stop (payload-shape skew): any stop should
    // cancel SOME start, biased toward finishing.
    const skewA = "task-skew-a";
    noteSubagentStart(skewA, "a");
    noteSubagentStop(skewA, undefined);
    expect(hasActiveSubagents(skewA)).toBe(false);

    // Anonymous start, keyed stop.
    const skewB = "task-skew-b";
    noteSubagentStart(skewB, undefined);
    noteSubagentStop(skewB, "b");
    expect(hasActiveSubagents(skewB)).toBe(false);
  });

  it("clears all tracked subagents for a task", () => {
    const taskId = "task-clear";
    noteSubagentStart(taskId, "a");
    noteSubagentStart(taskId, undefined);
    clearSubagentActivity(taskId);
    expect(hasActiveSubagents(taskId)).toBe(false);
  });
});

describe("deferred finish backstop", () => {
  it("finishes a held task once its never-stopped subagents expire", () => {
    vi.useFakeTimers();
    const taskId = "task-backstop";
    const finished: string[] = [];
    noteSubagentStart(taskId, "lost");
    armDeferredFinish(taskId, (id) => finished.push(id));

    // While the entry is fresh, ticks wait — the subagent may be working.
    vi.advanceTimersByTime(RECHECK_MS * 3);
    expect(finished).toEqual([]);

    // Once the entry outlives the TTL with no SubagentStop, promote.
    vi.advanceTimersByTime(TTL_MS);
    expect(finished).toEqual([taskId]);
    expect(hasActiveSubagents(taskId)).toBe(false);

    // One-shot: no repeat promotions.
    vi.advanceTimersByTime(RECHECK_MS * 3);
    expect(finished).toEqual([taskId]);
  });

  it("disarms silently when real SubagentStops empty the set", () => {
    vi.useFakeTimers();
    const taskId = "task-real-stops";
    const finished: string[] = [];
    noteSubagentStart(taskId, "a");
    armDeferredFinish(taskId, (id) => finished.push(id));

    // The real stop means the main agent gets re-invoked and its own Stop
    // lands the finish — the backstop must NOT fire a premature one.
    noteSubagentStop(taskId, "a");
    vi.advanceTimersByTime(TTL_MS + RECHECK_MS * 2);
    expect(finished).toEqual([]);
  });

  it("can be disarmed explicitly and by clearSubagentActivity", () => {
    vi.useFakeTimers();
    const taskA = "task-disarm";
    const taskB = "task-clear-disarm";
    const finished: string[] = [];
    noteSubagentStart(taskA, "a");
    noteSubagentStart(taskB, "b");
    armDeferredFinish(taskA, (id) => finished.push(id));
    armDeferredFinish(taskB, (id) => finished.push(id));

    disarmDeferredFinish(taskA);
    clearSubagentActivity(taskB);
    vi.advanceTimersByTime(TTL_MS + RECHECK_MS * 2);
    expect(finished).toEqual([]);
  });
});
