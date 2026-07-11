// One IPC listener per PTY transport, demuxed by ptyId — instead of one
// listener per terminal pane.
//
// Historically every mounted pane subscribed to the transport's `onData`/
// `onExit` and filtered by ptyId itself; with N panes every chunk of every PTY
// invoked N callbacks (and TerminalPane's non-owners each buffered the chunk
// into their own pending map). That made renderer work per chunk O(panes).
// The router keeps a single subscription per transport and routes each message
// to the pane that CLAIMED its ptyId.
//
// Output for a pty nobody has claimed yet (the window between `spawn()`
// starting and the pane learning its ptyId) is buffered here — bounded per pty
// and in total — and handed over via `takePendingData`/`takePendingExit` when
// the pane wires up, exactly like the per-pane pending maps used to.

import {
  appendBoundedSequencedData,
  sequencedPtyData,
  type SequencedPtyData,
} from "./terminal-replay";

export type PtyDataMsg = { ptyId: string; data: string; seq: number };
export type PtyExitMsg = { ptyId: string; exitCode: number; signal?: number };

/** Structural match for `electron.pty` and `electron.remotePty`. */
export type PtyStreamTransport = {
  onData: (cb: (msg: PtyDataMsg) => void) => () => void;
  onExit: (cb: (msg: PtyExitMsg) => void) => () => void;
};

export type PtyStreamHandlers = {
  data: (msg: PtyDataMsg) => void;
  exit: (msg: PtyExitMsg) => void;
};

export interface PtyStreamRouter {
  /**
   * Route this pty's messages to `handlers` from now on. Returns an unclaim
   * fn; unclaiming only removes the claim if it is still the active one, so a
   * stale surface tearing down can't detach its successor.
   */
  claim(ptyId: string, handlers: PtyStreamHandlers): () => void;
  /** Drain buffered output that arrived while the pty was unclaimed. */
  takePendingData(ptyId: string): SequencedPtyData[];
  /** Drain a buffered exit that arrived while the pty was unclaimed. */
  takePendingExit(ptyId: string): PtyExitMsg | null;
}

/** Per-pty cap on buffered unclaimed output (same bound the panes used). */
const PENDING_OUTPUT_MAX_CHARS = 64_000;
/** Total unclaimed ptys tracked; beyond this the oldest entries are dropped.
 *  Anything dropped is still recoverable through the main-process replay ring. */
const MAX_UNCLAIMED_PTYS = 64;

export function createPtyStreamRouter(transport: PtyStreamTransport): PtyStreamRouter {
  const claims = new Map<string, PtyStreamHandlers>();
  const pendingData = new Map<string, SequencedPtyData[]>();
  const pendingExit = new Map<string, PtyExitMsg>();

  const evictOldest = (map: Map<string, unknown>) => {
    while (map.size > MAX_UNCLAIMED_PTYS) {
      const oldest = map.keys().next().value as string | undefined;
      if (oldest === undefined) return;
      map.delete(oldest);
    }
  };

  // Subscribed for the transport's lifetime — this pair replaces the
  // two-listeners-per-pane pattern, it is not a leak.
  transport.onData((msg) => {
    const handlers = claims.get(msg.ptyId);
    if (handlers) {
      handlers.data(msg);
      return;
    }
    const chunks = pendingData.get(msg.ptyId) ?? [];
    appendBoundedSequencedData(
      chunks,
      sequencedPtyData(msg.seq, msg.data),
      PENDING_OUTPUT_MAX_CHARS,
    );
    pendingData.set(msg.ptyId, chunks);
    evictOldest(pendingData);
  });
  transport.onExit((msg) => {
    const handlers = claims.get(msg.ptyId);
    if (handlers) {
      handlers.exit(msg);
      return;
    }
    pendingExit.set(msg.ptyId, msg);
    evictOldest(pendingExit);
  });

  return {
    claim(ptyId, handlers) {
      claims.set(ptyId, handlers);
      return () => {
        if (claims.get(ptyId) === handlers) claims.delete(ptyId);
      };
    },
    takePendingData(ptyId) {
      const chunks = pendingData.get(ptyId) ?? [];
      pendingData.delete(ptyId);
      return chunks;
    },
    takePendingExit(ptyId) {
      const msg = pendingExit.get(ptyId) ?? null;
      pendingExit.delete(ptyId);
      return msg;
    },
  };
}

const routers = new WeakMap<PtyStreamTransport, PtyStreamRouter>();

/** The shared router for a transport (`electron.pty` / `electron.remotePty`). */
export function getPtyStreamRouter(transport: PtyStreamTransport): PtyStreamRouter {
  let router = routers.get(transport);
  if (!router) {
    router = createPtyStreamRouter(transport);
    routers.set(transport, router);
  }
  return router;
}
