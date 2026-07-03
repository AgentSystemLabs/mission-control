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

describe("theme-style", () => {
  let storage: ReturnType<typeof mockWindowStorage>;

  beforeEach(() => {
    vi.resetModules();
    storage = mockWindowStorage();
  });

  afterEach(() => {
    storage.restore();
  });

  it("reads painted when no preference is cached", async () => {
    const mod = await import("../theme-style");
    expect(mod.readCachedThemeStyle()).toBe("painted");
  });

  it("falls back to the legacy minimal flag when only it is cached", async () => {
    const mod = await import("../theme-style");
    storage.store.set(mod.MINIMAL_CACHE_KEY, "1");
    expect(mod.readCachedThemeStyle()).toBe("minimal");
  });

  it("prefers the style cache over the legacy flag", async () => {
    const mod = await import("../theme-style");
    storage.store.set(mod.MINIMAL_CACHE_KEY, "1");
    storage.store.set(mod.THEME_STYLE_CACHE_KEY, "painted");
    expect(mod.readCachedThemeStyle()).toBe("painted");
  });

  it("ignores an invalid cached style", async () => {
    const mod = await import("../theme-style");
    storage.store.set(mod.THEME_STYLE_CACHE_KEY, "vaporwave");
    expect(mod.readCachedThemeStyle()).toBe("painted");
  });

  it("caches noir and mirrors the legacy flag on", async () => {
    const mod = await import("../theme-style");
    // In the node test env `document` is undefined, so applyThemeStyle only
    // touches localStorage — exactly the branch we want to assert.
    mod.applyThemeStyle("noir");
    expect(storage.store.get(mod.THEME_STYLE_CACHE_KEY)).toBe("noir");
    expect(storage.store.get(mod.MINIMAL_CACHE_KEY)).toBe("1");
    expect(mod.readCachedThemeStyle()).toBe("noir");
  });

  it("caches painted and mirrors the legacy flag off", async () => {
    const mod = await import("../theme-style");
    mod.applyThemeStyle("minimal");
    mod.applyThemeStyle("painted");
    expect(storage.store.get(mod.THEME_STYLE_CACHE_KEY)).toBe("painted");
    expect(storage.store.get(mod.MINIMAL_CACHE_KEY)).toBe("0");
    expect(mod.readCachedThemeStyle()).toBe("painted");
  });
});
