// PTY output is coalesced per PTY before crossing IPC to the renderer: chatty
// agent TUIs (spinners, token streams) emit dozens–hundreds of chunks per
// second, and one renderer wakeup per chunk × N sessions was a measurable
// battery drain. Chunks still land in each source's replay ring (and get their
// seq) immediately — only renderer delivery is batched. While the main window
// is hidden the flush slows further; ordering is preserved end to end so
// nothing needs a resync when the window comes back.
//
// CORRECTNESS INVARIANT (replay). A batched message carries the seq of its
// LAST chunk, and the renderer keeps or drops a message wholesale against a
// replay snapshot's nextSeq (see src/lib/terminal-replay.ts). A message must
// therefore never mix chunks from both sides of a snapshot. Callers guarantee
// that by calling `flush(ptyId)` at the snapshot boundary: pty-manager flushes
// inside the ptyReplay handler; sandbox-manager flushes when the agent's
// replay result arrives (WS delivery is ordered, so everything received before
// the result is pre-snapshot and everything after is post-snapshot).

const PTY_FLUSH_MS = 16;
const PTY_FLUSH_HIDDEN_MS = 1000;
/** Battery-saver cadence for terminals the user isn't interacting with —
 *  agent spinners repaint ~10×/s per session; 4 flushes/s caps that while the
 *  terminal being typed into stays on the real-time cadence. */
const PTY_FLUSH_POWER_SAVE_MS = 250;
/** Force a flush mid-interval once this much output is pending (keeps huge
 *  bursts flowing and bounds pending memory). */
const PTY_FLUSH_MAX_PENDING_CHARS = 262_144;

let streamHidden = false;
let powerSaveActive = false;
const visibleListeners = new Set<() => void>();

/**
 * Called from main-window visibility events. While hidden, batches flush at
 * `PTY_FLUSH_HIDDEN_MS` (the renderer can't paint anyway); on show every
 * pending batch is flushed immediately so terminals are current the moment
 * they're visible.
 */
export function setPtyStreamHidden(hidden: boolean): void {
  if (streamHidden === hidden) return;
  streamHidden = hidden;
  if (!hidden) {
    for (const listener of visibleListeners) listener();
  }
}

/**
 * Battery-saver signal, forwarded from the renderer (which owns the setting;
 * see src/lib/power-save.ts). While active, output for PTYs WITHOUT recent
 * user input flushes at `PTY_FLUSH_POWER_SAVE_MS`.
 */
export function setPtyStreamPowerSave(active: boolean): void {
  powerSaveActive = active;
}

/** Test-only reset of module state. */
export function resetPtyStreamVisibilityForTests(): void {
  streamHidden = false;
  powerSaveActive = false;
  visibleListeners.clear();
}

type PendingBatch = {
  data: string;
  seq: number;
  timer: ReturnType<typeof setTimeout> | null;
};

export class PtyOutputBatcher {
  private pending = new Map<string, PendingBatch>();
  private readonly onVisible = () => this.flushAll();

  constructor(
    private readonly emit: (ptyId: string, data: string, seq: number) => void,
  ) {
    visibleListeners.add(this.onVisible);
  }

  /**
   * Queue a chunk; `seq` must be the chunk's own sequence number.
   * `interactive` marks a PTY with recent user input — it keeps the real-time
   * cadence even under battery saver (typing echo must never lag).
   */
  push(ptyId: string, seq: number, data: string, interactive = false): void {
    let batch = this.pending.get(ptyId);
    if (!batch) {
      batch = { data: "", seq: 0, timer: null };
      this.pending.set(ptyId, batch);
    }
    batch.data += data;
    batch.seq = seq;
    if (batch.data.length >= PTY_FLUSH_MAX_PENDING_CHARS) {
      this.flush(ptyId);
      return;
    }
    if (batch.timer === null) {
      const interval = streamHidden
        ? PTY_FLUSH_HIDDEN_MS
        : powerSaveActive && !interactive
          ? PTY_FLUSH_POWER_SAVE_MS
          : PTY_FLUSH_MS;
      batch.timer = setTimeout(() => this.flush(ptyId), interval);
    }
  }

  /** Deliver the pending batch for `ptyId` now (no-op when nothing pending). */
  flush(ptyId: string): void {
    const batch = this.pending.get(ptyId);
    if (!batch) return;
    if (batch.timer !== null) clearTimeout(batch.timer);
    this.pending.delete(ptyId);
    if (batch.data) this.emit(ptyId, batch.data, batch.seq);
  }

  flushAll(): void {
    for (const ptyId of [...this.pending.keys()]) this.flush(ptyId);
  }

  /** Flush everything and stop listening for visibility changes. */
  dispose(): void {
    this.flushAll();
    visibleListeners.delete(this.onVisible);
  }
}
