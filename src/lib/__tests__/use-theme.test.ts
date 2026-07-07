import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Exercises the dark/light preference logic without rendering the React hook
// (the test env is node, no DOM renderer): readCachedTheme() and the way
// applyThemeStyle reconciles `data-theme` — painted is always dark, the flat
// theme honours the stored preference.

function mockDom() {
  const store = new Map<string, string>();
  const attrs = new Map<string, string>();
  const previousWindow = globalThis.window;

  globalThis.window = {
    localStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
    },
  } as unknown as Window & typeof globalThis;

  vi.stubGlobal("document", {
    documentElement: {
      getAttribute: (name: string) => attrs.get(name) ?? null,
      setAttribute: (name: string, value: string) => void attrs.set(name, value),
      removeAttribute: (name: string) => void attrs.delete(name),
    },
  });

  return {
    store,
    attrs,
    restore() {
      globalThis.window = previousWindow;
      vi.unstubAllGlobals();
    },
  };
}

describe("use-theme + data-theme reconciliation", () => {
  let dom: ReturnType<typeof mockDom>;

  beforeEach(() => {
    vi.resetModules();
    dom = mockDom();
  });

  afterEach(() => {
    dom.restore();
  });

  it("defaults the cached theme to dark and reads a stored light preference", async () => {
    const { readCachedTheme } = await import("../use-theme");
    expect(readCachedTheme()).toBe("dark");
    dom.store.set("mc.theme", "light");
    expect(readCachedTheme()).toBe("light");
  });

  it("applies the stored light preference when the flat theme is selected", async () => {
    dom.store.set("mc.theme", "light");
    const { applyThemeStyle } = await import("../theme-style");
    applyThemeStyle("flat");
    expect(dom.attrs.get("data-minimal")).toBe("true");
    expect(dom.attrs.get("data-theme")).toBe("light");
  });

  it("forces dark for the painted theme even with a stored light preference", async () => {
    dom.store.set("mc.theme", "light");
    const { applyThemeStyle } = await import("../theme-style");
    applyThemeStyle("painted");
    expect(dom.attrs.has("data-minimal")).toBe(false);
    expect(dom.attrs.get("data-theme")).toBe("dark");
  });
});
