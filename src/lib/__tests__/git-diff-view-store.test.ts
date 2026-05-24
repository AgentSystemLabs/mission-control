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

describe("git-diff-view-store", () => {
  let storage: ReturnType<typeof mockWindowStorage>;

  beforeEach(() => {
    vi.resetModules();
    storage = mockWindowStorage();
  });

  afterEach(() => {
    storage.restore();
  });

  it("persists open state per project independently", async () => {
    const store = await import("../git-diff-view-store");

    store.setGitDiffViewOpen("project-a", true);
    store.setGitDiffViewOpen("project-b", true);
    store.setGitDiffViewOpen("project-b", false);

    expect(store.isGitDiffViewOpen("project-a")).toBe(true);
    expect(store.isGitDiffViewOpen("project-b")).toBe(false);
  });

  it("reloads persisted state from localStorage", async () => {
    storage.store.set(
      "mc.gitDiffViewOpenByProject",
      JSON.stringify({ "project-a": true, "project-b": false, bad: "value" }),
    );

    const store = await import("../git-diff-view-store");

    expect(store.isGitDiffViewOpen("project-a")).toBe(true);
    expect(store.isGitDiffViewOpen("project-b")).toBe(false);
  });

  it("toggles only the targeted project", async () => {
    const store = await import("../git-diff-view-store");

    store.setGitDiffViewOpen("project-a", true);
    store.toggleGitDiffViewOpen("project-a");
    store.toggleGitDiffViewOpen("project-b");

    expect(store.isGitDiffViewOpen("project-a")).toBe(false);
    expect(store.isGitDiffViewOpen("project-b")).toBe(true);
  });

  it("keeps open state after reload when the project was left open", async () => {
    const store = await import("../git-diff-view-store");

    store.setGitDiffViewOpen("project-a", true);

    vi.resetModules();
    const reloaded = await import("../git-diff-view-store");

    expect(reloaded.isGitDiffViewOpen("project-a")).toBe(true);
  });
});
