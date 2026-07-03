// GPU-accelerated terminal rendering, managed as a LEASE per xterm surface.
//
// WHY A LEASE AND NOT JUST `loadAddon(new WebglAddon())`
// Chromium hard-caps live WebGL contexts per renderer (~16); creating one more
// silently evicts the oldest ("context lost"), which would thrash a session
// grid showing many terminals. And parked surfaces (see terminal-surface-cache)
// stay alive offscreen indefinitely — holding a GPU context there forever
// wastes the budget on terminals nobody can see. So each surface owns a lease
// that the pane attaches while the terminal is actually mounted and detaches
// when it parks, and a module-level counter caps how many WebGL renderers
// exist at once. A detached lease keeps its context for a short grace period
// (released early under cap pressure), so a project-switch round trip reuses
// the contexts instead of tearing down and re-creating one per pane. Terminals
// beyond the cap — or on machines without usable WebGL2 — simply stay on
// xterm's DOM renderer.
//
// FAILURE PATHS ALL LAND ON THE DOM RENDERER
// xterm re-creates its DOM renderer automatically whenever the addon is
// disposed, so context loss (GPU reset, eviction), addon init throwing
// (blocklisted GPU, headless), or the chunk failing to load are each handled
// by dropping the addon and doing nothing else.

import type { Terminal } from "@xterm/xterm";
import type { WebglAddon as XWebglAddon } from "@xterm/addon-webgl";

/** Concurrent WebGL renderers, kept under Chromium's ~16-context ceiling. */
const MAX_GPU_TERMINALS = 12;

/**
 * How long a parked surface keeps its live WebGL context. Switching projects
 * parks every pane of the old scope and remounts them on the way back; without
 * a grace period that round trip pays context teardown × N on leave and
 * context creation × N on return — the bulk of the project-switch jank.
 * Bounded so parked-but-busy terminals don't render on the GPU indefinitely,
 * and retained contexts are evicted early whenever a visible terminal needs
 * the slot.
 */
const RETAINED_CONTEXT_MS = 30_000;

/**
 * Leases currently parked with a retained context, oldest first. Each value
 * force-releases its lease's context; an attach that hits the context cap
 * evicts from here, so on-screen terminals always outrank parked ones.
 */
const retained = new Set<() => void>();

export interface TerminalGpuLease {
  /** Request GPU rendering — call when the surface is (re)mounted. Async + best-effort. */
  attach(): void;
  /** Release the GPU context — call when the surface parks offscreen. */
  detach(): void;
  /** Final release — call from surface teardown, before `term.dispose()`. */
  dispose(): void;
}

let activeCount = 0;
let webglSupport: boolean | null = null;
let addonCtor: Promise<typeof XWebglAddon | null> | null = null;

function detectWebglSupport(): boolean {
  if (webglSupport !== null) return webglSupport;
  try {
    const gl = document
      .createElement("canvas")
      // Mirrors the addon's own context request; the caveat flag keeps us on
      // the DOM renderer when WebGL would be software-emulated anyway.
      .getContext("webgl2", { failIfMajorPerformanceCaveat: true });
    webglSupport = !!gl;
    (gl as WebGL2RenderingContext | null)
      ?.getExtension("WEBGL_lose_context")
      ?.loseContext();
  } catch {
    webglSupport = false;
  }
  return webglSupport;
}

function loadAddonCtor(): Promise<typeof XWebglAddon | null> {
  if (!addonCtor) {
    addonCtor = import("@xterm/addon-webgl")
      .then((m) => m.WebglAddon)
      .catch(() => null);
  }
  return addonCtor;
}

/** Warm the addon chunk so the first attach doesn't wait on the network/disk. */
export function prefetchTerminalWebgl(): void {
  if (typeof document === "undefined") return;
  if (detectWebglSupport()) void loadAddonCtor();
}

/** Test-only reset of module state. */
export function resetTerminalWebglForTests(): void {
  activeCount = 0;
  webglSupport = null;
  addonCtor = null;
  retained.clear();
}

export function createTerminalGpuLease(term: Terminal): TerminalGpuLease {
  let addon: XWebglAddon | null = null;
  let wanted = false;
  let disposed = false;
  // Bumped on every detach/dispose so an in-flight attach from a previous
  // mount can't land after the surface parked.
  let generation = 0;

  let retainTimer: ReturnType<typeof setTimeout> | null = null;

  const drop = () => {
    const current = addon;
    if (!current) return;
    addon = null;
    activeCount -= 1;
    try {
      current.dispose();
    } catch {
      /* already torn down with the terminal */
    }
  };

  const stopRetain = () => {
    if (retainTimer !== null) {
      clearTimeout(retainTimer);
      retainTimer = null;
    }
    retained.delete(forceDrop);
  };

  const forceDrop = () => {
    stopRetain();
    drop();
  };

  const attachNow = async (gen: number) => {
    if (!detectWebglSupport()) return;
    const Ctor = await loadAddonCtor();
    if (!Ctor || disposed || !wanted || gen !== generation || addon) return;
    // At the cap: evict parked-but-retained contexts (oldest first) before
    // giving up — a terminal actually on screen outranks any parked one.
    while (activeCount >= MAX_GPU_TERMINALS) {
      const evictOldest = retained.values().next().value;
      if (!evictOldest) return;
      evictOldest();
    }
    try {
      const next = new Ctor();
      term.loadAddon(next);
      addon = next;
      activeCount += 1;
      // GPU reset or context eviction: fall back to the DOM renderer for this
      // terminal and free the slot for the next attach.
      next.onContextLoss(() => forceDrop());
    } catch {
      // Init failed (blocklisted GPU, driver quirk) — assume it will keep
      // failing and stop trying for every other terminal too.
      webglSupport = false;
    }
  };

  return {
    attach() {
      if (disposed) return;
      wanted = true;
      // Parked with the context retained: reattaching is free — just keep it.
      if (addon) {
        stopRetain();
        return;
      }
      void attachNow(generation);
    },
    detach() {
      wanted = false;
      generation += 1;
      if (!addon) return;
      // Park with the context alive for a grace period (or until an on-screen
      // terminal needs the slot) so a quick return skips context re-creation.
      stopRetain();
      retained.add(forceDrop);
      retainTimer = setTimeout(forceDrop, RETAINED_CONTEXT_MS);
    },
    dispose() {
      disposed = true;
      wanted = false;
      generation += 1;
      forceDrop();
    },
  };
}
