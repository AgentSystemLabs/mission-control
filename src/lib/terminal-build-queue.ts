/**
 * Turn-taking serializer for heavy xterm surface builds.
 *
 * Mounting the session grid creates every pane's surface in the same React
 * commit; unthrottled, N builds (`new Terminal()` + `open()` renderer init +
 * font measurement + a WebGL context each) land in one long main-thread task
 * and the route transition can't paint until all of them finish — a
 * multi-second freeze when opening a project whose grid holds many sessions.
 * Builds instead take turns, and each turn begins after the browser has had a
 * chance to paint (rAF → macrotask), so the page renders immediately and the
 * cells fill in over the next few frames.
 *
 * This is deliberately separate from pty-spawn-queue: that throttles agent
 * PROCESS boots (whole-machine load), this throttles renderer-thread DOM/GPU
 * work (paint latency). A pane holds both, at different stages.
 */

import { createAsyncSemaphore } from "./async-semaphore";

// Max 1 concurrent build — a plain mutex. Serializes heavy surface builds.
const buildSemaphore = createAsyncSemaphore(() => 1);

/** Resolves after the next frame has painted (macrotask fallback off-DOM). */
function afterNextPaint(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === "function") {
      // rAF runs just before render; the nested macrotask lands right after
      // the frame is painted.
      requestAnimationFrame(() => setTimeout(resolve, 0));
    } else {
      setTimeout(resolve, 0);
    }
  });
}

/**
 * Wait for a build turn. Resolves to a release function; callers MUST call it
 * exactly once (repeats are no-ops) when the surface build has finished —
 * including on error and cancelled-mid-build paths.
 */
export async function acquireSurfaceBuildTurn(): Promise<() => void> {
  const release = await buildSemaphore.acquire();
  await afterNextPaint();
  return release;
}
