// GPU-accelerated terminal rendering, managed as a LEASE per xterm surface.
//
// WHY A LEASE AND NOT JUST `loadAddon(new WebglAddon())`
// Chromium hard-caps live WebGL contexts per renderer (~16); creating one more
// silently evicts the oldest ("context lost"), which would thrash a session
// grid showing many terminals. And parked surfaces (see terminal-surface-cache)
// stay alive offscreen indefinitely — holding a GPU context there wastes the
// budget on terminals nobody can see. So each surface owns a lease that the
// pane attaches while the terminal is actually mounted and detaches when it
// parks, and a module-level counter caps how many WebGL renderers exist at
// once. Terminals beyond the cap — or on machines without usable WebGL2 —
// simply stay on xterm's DOM renderer.
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
}

export function createTerminalGpuLease(term: Terminal): TerminalGpuLease {
  let addon: XWebglAddon | null = null;
  let wanted = false;
  let disposed = false;
  // Bumped on every detach/dispose so an in-flight attach from a previous
  // mount can't land after the surface parked.
  let generation = 0;

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

  const attachNow = async (gen: number) => {
    if (!detectWebglSupport() || activeCount >= MAX_GPU_TERMINALS) return;
    const Ctor = await loadAddonCtor();
    if (!Ctor || disposed || !wanted || gen !== generation || addon) return;
    if (activeCount >= MAX_GPU_TERMINALS) return;
    try {
      const next = new Ctor();
      term.loadAddon(next);
      addon = next;
      activeCount += 1;
      // GPU reset or context eviction: fall back to the DOM renderer for this
      // terminal and free the slot for the next attach.
      next.onContextLoss(() => drop());
    } catch {
      // Init failed (blocklisted GPU, driver quirk) — assume it will keep
      // failing and stop trying for every other terminal too.
      webglSupport = false;
    }
  };

  return {
    attach() {
      if (disposed || addon) return;
      wanted = true;
      void attachNow(generation);
    },
    detach() {
      wanted = false;
      generation += 1;
      drop();
    },
    dispose() {
      disposed = true;
      wanted = false;
      generation += 1;
      drop();
    },
  };
}
