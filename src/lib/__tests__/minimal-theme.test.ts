import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

describe("minimal-theme", () => {
  let storage: ReturnType<typeof mockWindowStorage>;

  beforeEach(() => {
    vi.resetModules();
    storage = mockWindowStorage();
  });

  afterEach(() => {
    storage.restore();
  });

  it("reads false when no preference is cached", async () => {
    const mod = await import("../minimal-theme");
    expect(mod.readCachedMinimalTheme()).toBe(false);
  });

  it("caches '1' when minimal is applied and reads it back true", async () => {
    const mod = await import("../minimal-theme");
    // In the node test env `document` is undefined, so applyMinimalTheme only
    // touches localStorage — exactly the branch we want to assert.
    mod.applyMinimalTheme(true);
    expect(storage.store.get(mod.MINIMAL_CACHE_KEY)).toBe("1");
    expect(mod.readCachedMinimalTheme()).toBe(true);
  });

  it("caches '0' when painted is applied and reads it back false", async () => {
    const mod = await import("../minimal-theme");
    mod.applyMinimalTheme(true);
    mod.applyMinimalTheme(false);
    expect(storage.store.get(mod.MINIMAL_CACHE_KEY)).toBe("0");
    expect(mod.readCachedMinimalTheme()).toBe(false);
  });
});
