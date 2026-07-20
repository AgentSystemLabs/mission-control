// Tracks which Claude Code subagents are still running, per task.
//
// Claude Code fires the top-level Stop hook when the FOREGROUND turn ends —
// including while background subagents it launched are still working. Each
// completion re-invokes the main agent, whose eventual Stop (with nothing
// left active here) is the session's real finish. The hooks controller
// records SubagentStart/SubagentStop here and downgrades a Stop to "running"
// while any subagent remains active, so the finish ding doesn't fire mid-work.
//
// In-memory and bounded like the controller's other per-task maps: losing
// state (app restart) merely restores the legacy finish-on-Stop behavior.

const MAX_TRACKED_TASKS = 500;
const MAX_IDS_PER_TASK = 512;

// Backstop for a SubagentStop that never arrives (lost POST, killed process):
// entries older than this stop counting as active, so a task can't be held on
// "running" forever. Kept long because its only cost is how long that rare
// wedge can last — while a SHORT ttl would prematurely finish sessions whose
// subagents legitimately run long (deep-research fan-outs).
const ACTIVE_SUBAGENT_TTL_MS = 2 * 60 * 60 * 1000;

// Cadence of the deferred-finish recheck armed when a Stop is held. Each tick
// only acts once every remaining entry has EXPIRED (see armDeferredFinish);
// entries emptied by real SubagentStops disarm it without finishing.
const DEFERRED_FINISH_RECHECK_MS = 60 * 1000;

type TaskSubagents = {
  /** agent_id → start time, for payloads that identify the subagent. */
  ids: Map<string, number>;
  /** Count for payloads without agent_id (older Claude builds). */
  anonCount: number;
  /** Last change to anonCount, for TTL pruning. */
  anonTouchedAt: number;
};

const activeByTask = new Map<string, TaskSubagents>();
const recheckTimers = new Map<string, ReturnType<typeof setInterval>>();

function touch(taskId: string): TaskSubagents {
  let entry = activeByTask.get(taskId);
  if (entry) {
    // Re-insert so insertion order approximates recency for the cap below.
    activeByTask.delete(taskId);
  } else {
    entry = { ids: new Map(), anonCount: 0, anonTouchedAt: 0 };
  }
  activeByTask.set(taskId, entry);
  while (activeByTask.size > MAX_TRACKED_TASKS) {
    const oldest = activeByTask.keys().next().value;
    if (oldest === undefined) break;
    activeByTask.delete(oldest);
  }
  return entry;
}

export function noteSubagentStart(taskId: string, agentId: string | undefined): void {
  const entry = touch(taskId);
  const now = Date.now();
  if (agentId) {
    entry.ids.delete(agentId);
    entry.ids.set(agentId, now);
    while (entry.ids.size > MAX_IDS_PER_TASK) {
      const oldest = entry.ids.keys().next().value;
      if (oldest === undefined) break;
      entry.ids.delete(oldest);
    }
  } else {
    entry.anonCount += 1;
    entry.anonTouchedAt = now;
  }
}

export function noteSubagentStop(taskId: string, agentId: string | undefined): void {
  const entry = activeByTask.get(taskId);
  if (!entry) return;
  if (agentId) {
    if (!entry.ids.delete(agentId) && entry.anonCount > 0) {
      // Cross-cancel payload-shape skew (keyed stop after an anonymous
      // start): any stop should cancel SOME start, biased toward finishing.
      entry.anonCount -= 1;
      entry.anonTouchedAt = Date.now();
    }
  } else if (entry.anonCount > 0) {
    entry.anonCount -= 1;
    entry.anonTouchedAt = Date.now();
  } else {
    // Anonymous stop after keyed starts: cancel the oldest one.
    const oldest = entry.ids.keys().next().value;
    if (oldest !== undefined) entry.ids.delete(oldest);
  }
  if (isIdle(entry)) activeByTask.delete(taskId);
}

export function hasActiveSubagents(taskId: string): boolean {
  const entry = activeByTask.get(taskId);
  if (!entry) return false;
  prune(entry);
  if (isIdle(entry)) {
    activeByTask.delete(taskId);
    return false;
  }
  return true;
}

/**
 * Arm the lost-SubagentStop backstop after a Stop was held on "running".
 *
 * Normally the last SubagentStop re-invokes the main agent and ITS Stop lands
 * the real finish — the tick then finds no entry and silently disarms. The
 * `finish` callback fires only when entries emptied by EXPIRING (a stop that
 * never arrived), so the task can't stay wedged on "running" forever, and the
 * normal path never gets a premature finish from this timer.
 */
export function armDeferredFinish(taskId: string, finish: (taskId: string) => void): void {
  if (recheckTimers.has(taskId)) return;
  const timer = setInterval(() => {
    const entry = activeByTask.get(taskId);
    if (!entry) {
      disarmDeferredFinish(taskId);
      return;
    }
    prune(entry);
    if (!isIdle(entry)) return;
    activeByTask.delete(taskId);
    disarmDeferredFinish(taskId);
    finish(taskId);
  }, DEFERRED_FINISH_RECHECK_MS);
  timer.unref?.();
  recheckTimers.set(taskId, timer);
}

/** Cancel a pending deferred finish (new user turn supersedes the held Stop). */
export function disarmDeferredFinish(taskId: string): void {
  const timer = recheckTimers.get(taskId);
  if (timer === undefined) return;
  clearInterval(timer);
  recheckTimers.delete(taskId);
}

/** Drop all tracked subagents for a task (new session id = new Claude process). */
export function clearSubagentActivity(taskId: string): void {
  activeByTask.delete(taskId);
  disarmDeferredFinish(taskId);
}

function prune(entry: TaskSubagents): void {
  const cutoff = Date.now() - ACTIVE_SUBAGENT_TTL_MS;
  for (const [id, startedAt] of entry.ids) {
    if (startedAt < cutoff) entry.ids.delete(id);
  }
  if (entry.anonCount > 0 && entry.anonTouchedAt < cutoff) entry.anonCount = 0;
}

function isIdle(entry: TaskSubagents): boolean {
  return entry.ids.size === 0 && entry.anonCount === 0;
}
