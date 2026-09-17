// Tracks which Claude Code subagents are still running, per task.
//
// Claude Code fires the top-level Stop hook when the FOREGROUND turn ends —
// including while background subagents it launched are still working. Each
// completion re-invokes the main agent, whose eventual Stop (with nothing
// left active here) is the session's real finish. The hooks controller
// records SubagentStart/SubagentStop here and downgrades a Stop to "running"
// while any subagent remains active, so the finish ding doesn't fire mid-work.
//
// Claude Code also runs internal helper agents AFTER a session finishes
// (away-summary generation on refocus, title helpers) whose subagent events
// carry the parent session id but precede no further Stop. The recent-finish
// window (taskFinishedRecently) keeps those from healing a finished task back
// to "running", and the drain grace in armDeferredFinish un-wedges any that
// slip through.
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

// Cadence of the deferred-finish recheck armed when a Stop is held or a
// finished task was healed back to running by a subagent event.
const DEFERRED_FINISH_RECHECK_MS = 60 * 1000;

// Once a held/healed task's tracked subagents have all drained (real stops or
// expiry), wait this long for a main-agent Stop to land the finish itself
// before the backstop promotes the task. Long enough for a re-invoked main
// agent to compose its follow-up turn in the common case; short enough that a
// subagent event with no follow-up turn (Claude Code's internal helpers —
// away-summary generation and friends — fire SubagentStart/Stop with no Stop
// after) can't leave the task wedged on "running".
const DRAIN_FINISH_GRACE_MS = 3 * 60 * 1000;

// How long after a task finishes a subagent event can still plausibly belong
// to the finished turn (a Stop that won the race against the turn's own
// SubagentStart POST — a sub-second race in practice). Beyond this window a
// subagent event on a finished task is a post-turn internal helper, not
// resumed work, and must not heal the task back to "running".
const RECENT_FINISH_WINDOW_MS = 30 * 1000;

type TaskSubagents = {
  /** agent_id → start time, for payloads that identify the subagent. */
  ids: Map<string, number>;
  /** Count for payloads without agent_id (older Claude builds). */
  anonCount: number;
  /** Last change to anonCount, for TTL pruning. */
  anonTouchedAt: number;
};

type RecheckState = {
  timer: ReturnType<typeof setInterval>;
  /** When the tracked set was first seen idle; null while work is active. */
  idleSince: number | null;
};

const activeByTask = new Map<string, TaskSubagents>();
const recheckTimers = new Map<string, RecheckState>();

// Last hook-driven "finished" per task, for the recent-finish heal window.
// In-memory and bounded like activeByTask; losing it (app restart) just means
// subagent events on finished tasks stop healing until the next real finish —
// the safe direction for the away-summary class of post-turn helper events.
const finishedAtByTask = new Map<string, number>();

/** Record that a hook just landed this task on "finished". */
export function noteTaskFinished(taskId: string): void {
  finishedAtByTask.delete(taskId);
  finishedAtByTask.set(taskId, Date.now());
  while (finishedAtByTask.size > MAX_TRACKED_TASKS) {
    const oldest = finishedAtByTask.keys().next().value;
    if (oldest === undefined) break;
    finishedAtByTask.delete(oldest);
  }
}

/**
 * True while a subagent event can still mean "the finished Stop raced the
 * turn's own subagent lifecycle POSTs". Unknown tasks report false — after a
 * restart the heal stays off until a real finish is observed again.
 */
export function taskFinishedRecently(taskId: string): boolean {
  const finishedAt = finishedAtByTask.get(taskId);
  if (finishedAt === undefined) return false;
  return Date.now() - finishedAt <= RECENT_FINISH_WINDOW_MS;
}

/**
 * Drop a task's recent-finish mark. Used when its session PROCESS died: no
 * re-invocation can follow a dead process, so a laggard subagent POST still in
 * flight must read as stale (ignored) rather than heal the task to "running"
 * — a heal there would wedge until the TTL, since its stop can never arrive.
 */
export function clearTaskFinished(taskId: string): void {
  finishedAtByTask.delete(taskId);
}

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
  // Fresh activity ends any drain grace in progress — the set is live again.
  const recheck = recheckTimers.get(taskId);
  if (recheck) recheck.idleSince = null;
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
 * Arm the "running with no Stop coming" backstop after a Stop was held on
 * "running", or after a finished task was healed back to "running" by a
 * subagent event.
 *
 * Each tick waits while tracked subagents are active. Once the set is idle —
 * emptied by real SubagentStops OR by expiry — a drain grace starts: if a
 * main-agent Stop lands the finish within it (the normal background-subagent
 * flow), the `finish` callback is a no-op for the caller (it guards on status
 * still being "running"). If nothing follows — a lost SubagentStop, or a
 * post-turn helper's subagent events that never precede another Stop — the
 * grace expires and `finish` promotes the task, so it can't stay wedged on
 * "running" forever.
 */
export function armDeferredFinish(taskId: string, finish: (taskId: string) => void): void {
  if (recheckTimers.has(taskId)) return;
  const state: RecheckState = {
    timer: setInterval(() => {
      const entry = activeByTask.get(taskId);
      if (entry) {
        prune(entry);
        if (!isIdle(entry)) {
          state.idleSince = null;
          return;
        }
        activeByTask.delete(taskId);
      }
      const now = Date.now();
      if (state.idleSince === null) {
        state.idleSince = now;
        return;
      }
      if (now - state.idleSince < DRAIN_FINISH_GRACE_MS) return;
      disarmDeferredFinish(taskId);
      finish(taskId);
    }, DEFERRED_FINISH_RECHECK_MS),
    idleSince: null,
  };
  state.timer.unref?.();
  recheckTimers.set(taskId, state);
}

/** Cancel a pending deferred finish (new user turn supersedes the held Stop). */
export function disarmDeferredFinish(taskId: string): void {
  const state = recheckTimers.get(taskId);
  if (state === undefined) return;
  clearInterval(state.timer);
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
