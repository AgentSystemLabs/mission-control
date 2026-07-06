import { describe, expect, it, vi } from "vitest";
import {
  createTerminalSurfaceCache,
  MAX_PARKED_SURFACES,
  type TerminalSurface,
} from "../terminal-surface-cache";

// The cache only ever touches el.remove() and holder.appendChild(el); fake both so
// the state-machine semantics are testable in the node env (no jsdom).
function makeFakeEl() {
  const el = {
    parent: null as null | { name: string },
    remove: vi.fn(() => {
      el.parent = null;
    }),
  };
  return el;
}

function makeHolder() {
  const appended: unknown[] = [];
  const holder = {
    name: "holder",
    appendChild: vi.fn((child: { parent: unknown }) => {
      child.parent = { name: "holder" };
      appended.push(child);
    }),
  };
  return {
    appended,
    holder: holder as unknown as Pick<HTMLElement, "appendChild"> & typeof holder,
  };
}

function makeSurface(id: string, el = makeFakeEl()) {
  const teardown = vi.fn();
  const surface = {
    id,
    el: el as unknown as HTMLDivElement,
    ptyId: null,
    destroyed: false,
    teardown,
  } satisfies TerminalSurface;
  return { surface, teardown, el };
}

describe("terminalSurfaceCache", () => {
  it("hands back a registered surface and reports presence", () => {
    const { holder } = makeHolder();
    const cache = createTerminalSurfaceCache({ getHolder: () => holder });
    const { surface } = makeSurface("a");

    expect(cache.get("a")).toBeNull();
    expect(cache.has("a")).toBe(false);

    cache.set(surface);
    expect(cache.get("a")).toBe(surface);
    expect(cache.has("a")).toBe(true);
    expect(cache.size()).toBe(1);
    expect(cache.ids()).toEqual(["a"]);
  });

  it("park re-parents the element into the holder without destroying it", () => {
    const env = makeHolder();
    const cache = createTerminalSurfaceCache({ getHolder: () => env.holder });
    const { surface, teardown, el } = makeSurface("a");
    cache.set(surface);

    cache.park("a");

    expect(env.holder.appendChild).toHaveBeenCalledWith(el);
    expect(el.parent).toEqual({ name: "holder" });
    expect(teardown).not.toHaveBeenCalled();
    expect(el.remove).not.toHaveBeenCalled();
    // Still alive and retrievable after parking.
    expect(cache.get("a")).toBe(surface);
  });

  it("destroy tears down once, removes the element, and forgets the id", () => {
    const { holder } = makeHolder();
    const cache = createTerminalSurfaceCache({ getHolder: () => holder });
    const { surface, teardown, el } = makeSurface("a");
    cache.set(surface);

    cache.destroy("a");

    expect(teardown).toHaveBeenCalledTimes(1);
    expect(el.remove).toHaveBeenCalledTimes(1);
    expect(surface.destroyed).toBe(true);
    expect(cache.get("a")).toBeNull();
    expect(cache.has("a")).toBe(false);
    expect(cache.size()).toBe(0);

    // Idempotent: a second destroy (or destroy of an unknown id) is a no-op.
    cache.destroy("a");
    cache.destroy("missing");
    expect(teardown).toHaveBeenCalledTimes(1);
  });

  it("a destroyed surface is never handed back out, even before deletion races", () => {
    const { holder } = makeHolder();
    const cache = createTerminalSurfaceCache({ getHolder: () => holder });
    const { surface } = makeSurface("a");
    cache.set(surface);
    cache.destroy("a");

    // Park after destroy must not resurrect or touch the holder.
    cache.park("a");
    expect(holder.appendChild).not.toHaveBeenCalled();
    expect(cache.get("a")).toBeNull();
  });

  it("replacing an id disposes the stranded surface", () => {
    const { holder } = makeHolder();
    const cache = createTerminalSurfaceCache({ getHolder: () => holder });
    const first = makeSurface("a");
    const second = makeSurface("a");
    cache.set(first.surface);

    cache.set(second.surface);

    expect(first.teardown).toHaveBeenCalledTimes(1);
    expect(first.el.remove).toHaveBeenCalledTimes(1);
    expect(first.surface.destroyed).toBe(true);
    expect(cache.get("a")).toBe(second.surface);
    expect(second.teardown).not.toHaveBeenCalled();
  });

  it("re-setting the same surface object is a no-op, not a self-teardown", () => {
    const { holder } = makeHolder();
    const cache = createTerminalSurfaceCache({ getHolder: () => holder });
    const { surface, teardown } = makeSurface("a");
    cache.set(surface);

    cache.set(surface);

    expect(teardown).not.toHaveBeenCalled();
    expect(cache.get("a")).toBe(surface);
  });

  // Fill the parked set to exactly the cap; caller asserts on the returned handles.
  function fillParked(cache: ReturnType<typeof createTerminalSurfaceCache>) {
    const made: ReturnType<typeof makeSurface>[] = [];
    for (let i = 0; i < MAX_PARKED_SURFACES; i++) {
      const s = makeSurface(`s${i}`);
      made.push(s);
      cache.set(s.surface);
      cache.park(`s${i}`);
    }
    return made;
  }

  it("evicts the least-recently-parked surface once the cap is exceeded", () => {
    const { holder } = makeHolder();
    const cache = createTerminalSurfaceCache({ getHolder: () => holder });
    const made = fillParked(cache);
    // At the cap, nothing is evicted yet.
    expect(cache.size()).toBe(MAX_PARKED_SURFACES);
    made.forEach((s) => expect(s.teardown).not.toHaveBeenCalled());

    // One more parked surface pushes the oldest (s0) out.
    const extra = makeSurface("extra");
    cache.set(extra.surface);
    cache.park("extra");

    expect(made[0]!.teardown).toHaveBeenCalledTimes(1);
    expect(cache.get("s0")).toBeNull();
    expect(cache.size()).toBe(MAX_PARKED_SURFACES);
    expect(cache.get("s1")).toBe(made[1]!.surface);
    expect(cache.get("extra")).toBe(extra.surface);
  });

  it("never evicts a re-mounted (markMounted) surface, only parked ones", () => {
    const { holder } = makeHolder();
    const cache = createTerminalSurfaceCache({ getHolder: () => holder });
    // A surface the user navigated back to: parked, then re-mounted.
    const kept = makeSurface("kept");
    cache.set(kept.surface);
    cache.park("kept");
    cache.markMounted("kept");

    const made = fillParked(cache);
    const extra = makeSurface("extra");
    cache.set(extra.surface);
    cache.park("extra");

    // Eviction targets the oldest PARKED surface (s0), never the mounted one.
    expect(kept.teardown).not.toHaveBeenCalled();
    expect(cache.get("kept")).toBe(kept.surface);
    expect(cache.get("s0")).toBeNull();
    expect(made[0]!.teardown).toHaveBeenCalledTimes(1);
  });

  it("re-parking refreshes recency so a revisited surface isn't the first evicted", () => {
    const { holder } = makeHolder();
    const cache = createTerminalSurfaceCache({ getHolder: () => holder });
    const made = fillParked(cache);
    // Touch s0 again (mount + re-park) so it becomes most-recent, not oldest.
    cache.markMounted("s0");
    cache.park("s0");

    const extra = makeSurface("extra");
    cache.set(extra.surface);
    cache.park("extra");

    // s1 is now the oldest and gets evicted; s0 survives.
    expect(cache.get("s0")).toBe(made[0]!.surface);
    expect(cache.get("s1")).toBeNull();
    expect(made[1]!.teardown).toHaveBeenCalledTimes(1);
  });
});
