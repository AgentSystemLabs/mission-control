import { afterEach, describe, expect, it, vi } from "vitest";

function mockWindowStorage(getItemImpl?: (key: string) => string | null) {
  const store = new Map<string, string>();
  const previousWindow = globalThis.window;

  globalThis.window = {
    localStorage: {
      getItem: getItemImpl ?? ((key: string) => store.get(key) ?? null),
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

describe("theme-onboarding", () => {
  let storage: ReturnType<typeof mockWindowStorage>;

  afterEach(() => {
    storage?.restore();
  });

  it("reports not-completed when the flag is absent", async () => {
    storage = mockWindowStorage();
    vi.resetModules();
    const mod = await import("../theme-onboarding");
    expect(mod.hasCompletedThemeOnboarding()).toBe(false);
  });

  it("marks completion and then reports completed", async () => {
    storage = mockWindowStorage();
    vi.resetModules();
    const mod = await import("../theme-onboarding");

    mod.markThemeOnboardingComplete();

    expect(storage.store.get("mc:themeOnboardingDone")).toBe("1");
    expect(mod.hasCompletedThemeOnboarding()).toBe(true);
  });

  it("fails closed (treats as completed) when storage is unreadable", async () => {
    storage = mockWindowStorage(() => {
      throw new Error("SecurityError");
    });
    vi.resetModules();
    const mod = await import("../theme-onboarding");
    expect(mod.hasCompletedThemeOnboarding()).toBe(true);
  });
});
