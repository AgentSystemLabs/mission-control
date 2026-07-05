// A module-level cache that decouples an xterm surface's lifetime from the React
// component that displays it.
//
// THE PROBLEM IT SOLVES
// Switching sandboxes (or navigating away and back) unmounts the terminal panes.
// Historically each pane created its own `Terminal`, painted scrollback, and on
// unmount called `term.dispose()`. Coming back rebuilt the xterm from scratch and
// replayed the entire scrollback over the agent socket — the visible "reconnect
// and restore" lag. The underlying PTYs and agent WebSockets were never actually
// torn down (the sandbox registry keeps them all live), so the only thing being
// thrown away was the *view*.
//
// THE FIX
// A surface owns the `Terminal`, the DOM element it rendered into, and its live
// PTY output subscription. The React pane becomes a thin mount point that:
//   - on mount: re-parents the existing element into its container (instant — the
//     buffer is already painted, the subscription kept it current while away), or
//     creates a fresh surface the first time it sees an id;
//   - on unmount: PARKS the surface (moves its element to an offscreen holder)
//     instead of disposing it.
// The surface is destroyed — subscriptions torn down, `Terminal` disposed — only
// when the session/terminal is really closed (close / kill / delete), via the
// store teardown paths. See TerminalPane.tsx / UserTerminalPane.tsx for the wiring.

/**
 * A cached terminal view. The fields after `el` are owned by the pane that
 * created the surface; the cache only ever touches `id`, `el`, `destroyed`, and
 * `teardown`. Panes store their richer object (subscriptions, replay state, the
 * mutable host callbacks, …) on the same record.
 */
export interface TerminalSurface {
  readonly id: string;
  /** The element passed to `term.open()`. Moved between mount containers and the holder. */
  readonly el: HTMLDivElement;
  /** Live PTY id this surface is wired to, or null before the first spawn / after exit. */
  ptyId: string | null;
  /** Set once `destroy()` has run; a destroyed surface is never handed back out. */
  destroyed: boolean;
  /** Tear down everything persistent: PTY subscriptions, watchers, `term.dispose()`. */
  teardown: () => void;
}

/** Imperative handle a pane keeps on its surface's `Terminal` (focus, font, clear). */
export interface CachedTerminalControls {
  focus(): void;
  setFontSize(fontSize: number): void;
  clear(): void;
  /** Write raw bytes to the surface's live PTY (tracks respawns). */
  writeToPty?(data: string): void;
}

/**
 * A surface owned by a terminal pane. `buildKey` encodes the spawn inputs (cwd /
 * retry nonce); when it changes the pane rebuilds the surface instead of
 * reattaching, so a Retry or a cwd change starts a genuinely fresh terminal.
 */
export interface PaneTerminalSurface extends TerminalSurface {
  buildKey: string;
  controls: CachedTerminalControls;
  /** Re-fit the xterm to whatever container it's currently parented in. */
  fit(): void;
  /**
   * GPU renderer lease (see terminal-webgl.ts) — attached while mounted,
   * released while parked so offscreen surfaces don't hold WebGL contexts.
   */
  gpu?: import("./terminal-webgl").TerminalGpuLease;
}

/** Injectable so the cache is testable in the node test env (no real `document`). */
export interface SurfaceCacheEnv {
  /** Offscreen element that holds parked surfaces, keeping their xterm in a live DOM. */
  getHolder: () => Pick<HTMLElement, "appendChild">;
}

export interface TerminalSurfaceCache {
  /** The live surface for `id`, or null if absent/destroyed. */
  get(id: string): TerminalSurface | null;
  has(id: string): boolean;
  /** Register a freshly-created surface. */
  set(surface: TerminalSurface): void;
  /**
   * Detach a surface from whatever container it's in by re-parenting its element
   * into the offscreen holder. The surface stays alive — subscriptions keep
   * writing into its buffer — so the next mount re-attaches instantly.
   */
  park(id: string): void;
  /**
   * Mark a surface as on-screen again (re-attached to a live container). Removes
   * it from the parked-eviction set so it can never be reaped while visible.
   * Call on every mount — both fresh builds and reattaches.
   */
  markMounted(id: string): void;
  /**
   * Fully dispose a surface: run its teardown (subscriptions + `term.dispose()`),
   * remove its element, and drop it from the cache. Idempotent and safe to call
   * for an unknown id.
   */
  destroy(id: string): void;
  /** Live (non-destroyed) surface ids — for diagnostics / eviction. */
  ids(): string[];
  size(): number;
}

/**
 * Cap on surfaces kept alive while PARKED (offscreen). Parking never disposed,
 * so navigating across many projects/sessions used to accumulate live xterm
 * instances + PTY subscriptions without bound (only GPU contexts were capped).
 * Beyond this many parked surfaces, the least-recently-parked is destroyed; its
 * session's PTY stays alive in the store, so returning to it just rebuilds the
 * view and replays — the original pre-cache cost, paid only for cold sessions.
 * Mounted (visible) surfaces are never counted here, so they're never reaped.
 */
export const MAX_PARKED_SURFACES = 16;

export function createTerminalSurfaceCache(env: SurfaceCacheEnv): TerminalSurfaceCache {
  const surfaces = new Map<string, TerminalSurface>();
  // Insertion-ordered set of currently-parked ids, least-recent first.
  const parked = new Set<string>();

  const disposeSurface = (id: string): void => {
    const s = surfaces.get(id);
    parked.delete(id);
    if (!s) return;
    surfaces.delete(id);
    if (s.destroyed) return;
    s.destroyed = true;
    try {
      s.teardown();
    } catch {
      /* best effort */
    }
    try {
      s.el.remove();
    } catch {
      /* best effort */
    }
  };

  return {
    get(id) {
      const s = surfaces.get(id);
      return s && !s.destroyed ? s : null;
    },
    has(id) {
      const s = surfaces.get(id);
      return !!s && !s.destroyed;
    },
    set(surface) {
      // Replacing an id should never strand the old surface's resources.
      const prev = surfaces.get(surface.id);
      if (prev && prev !== surface && !prev.destroyed) {
        prev.destroyed = true;
        try {
          prev.teardown();
        } catch {
          /* best effort */
        }
        try {
          prev.el.remove();
        } catch {
          /* best effort */
        }
      }
      // A freshly-registered surface is being mounted, not parked.
      parked.delete(surface.id);
      surfaces.set(surface.id, surface);
    },
    park(id) {
      const s = surfaces.get(id);
      if (!s || s.destroyed) return;
      try {
        env.getHolder().appendChild(s.el);
      } catch {
        /* best effort — a detached element is still fine, writes keep buffering */
      }
      // Move to most-recent (re-parking refreshes recency), then evict the
      // oldest parked surfaces beyond the cap. Never evicts the one just parked.
      parked.delete(id);
      parked.add(id);
      while (parked.size > MAX_PARKED_SURFACES) {
        const oldest = parked.values().next().value as string | undefined;
        if (oldest === undefined || oldest === id) break;
        disposeSurface(oldest);
      }
    },
    markMounted(id) {
      parked.delete(id);
    },
    destroy(id) {
      disposeSurface(id);
    },
    ids() {
      const out: string[] = [];
      for (const [id, s] of surfaces) if (!s.destroyed) out.push(id);
      return out;
    },
    size() {
      let n = 0;
      for (const s of surfaces.values()) if (!s.destroyed) n += 1;
      return n;
    },
  };
}

// ── Default singleton (real DOM) ────────────────────────────────────────────
let holderEl: HTMLDivElement | null = null;

function defaultGetHolder(): HTMLElement {
  if (!holderEl) {
    const el = document.createElement("div");
    el.setAttribute("data-terminal-surface-holder", "");
    // Offscreen but kept sized so xterm retains row/column dimensions while a
    // surface is parked — output written while detached still wraps sanely, and
    // a re-attach + fit() reflows it to the real container with minimal churn.
    el.style.cssText =
      "position:fixed;left:-99999px;top:0;width:1024px;height:640px;overflow:hidden;pointer-events:none;visibility:hidden;";
    document.body.appendChild(el);
    holderEl = el;
  }
  return holderEl;
}

export const terminalSurfaceCache = createTerminalSurfaceCache({ getHolder: defaultGetHolder });
