import { describe, expect, it, vi } from "vitest";
import {
  createTerminalSurfaceCache,
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
});
