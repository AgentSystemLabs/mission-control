import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isSurfaceTint } from "~/shared/surface-tint";

function mockWindowStorage() {
  const store = new Map<string, string>();
  const previousWindow = globalThis.window;

  globalThis.window = {
    localStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
      removeItem: (key: string) => {
        store.delete(key);
      },
    },
  } as unknown as Window & typeof globalThis;

  return {
    store,
    restore() {
      globalThis.window = previousWindow;
    },
  };
}

describe("surface-tint", () => {
  let storage: ReturnType<typeof mockWindowStorage>;

  beforeEach(() => {
    vi.resetModules();
    storage = mockWindowStorage();
  });

  afterEach(() => {
    storage.restore();
  });

  it("guards tint values", () => {
    expect(isSurfaceTint("off")).toBe(true);
    expect(isSurfaceTint("subtle")).toBe(true);
    expect(isSurfaceTint("vivid")).toBe(true);
    expect(isSurfaceTint("neon")).toBe(false);
    expect(isSurfaceTint(null)).toBe(false);
    expect(isSurfaceTint(1)).toBe(false);
  });

  it("reads subtle when no preference is cached", async () => {
    const mod = await import("../surface-tint");
    expect(mod.readCachedSurfaceTint()).toBe("subtle");
  });

  it("ignores an invalid cached tint", async () => {
    const mod = await import("../surface-tint");
    storage.store.set(mod.SURFACE_TINT_CACHE_KEY, "neon");
    expect(mod.readCachedSurfaceTint()).toBe("subtle");
  });

  it("caches the applied tint", async () => {
    const mod = await import("../surface-tint");
    // In the node test env `document` is undefined, so applySurfaceTint only
    // touches localStorage — exactly the branch we want to assert.
    mod.applySurfaceTint("vivid");
    expect(storage.store.get(mod.SURFACE_TINT_CACHE_KEY)).toBe("vivid");
    expect(mod.readCachedSurfaceTint()).toBe("vivid");
  });

  it("caches off (attribute-less) explicitly", async () => {
    const mod = await import("../surface-tint");
    mod.applySurfaceTint("vivid");
    mod.applySurfaceTint("off");
    expect(storage.store.get(mod.SURFACE_TINT_CACHE_KEY)).toBe("off");
    expect(mod.readCachedSurfaceTint()).toBe("off");
  });
});
