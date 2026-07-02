import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  FILE_FINDER_VIEW_STORAGE_KEY,
  readCachedFileFinderView,
  writeCachedFileFinderView,
} from "../ui-preference-cache";

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

describe("file finder view preference cache", () => {
  let storage: ReturnType<typeof mockWindowStorage>;

  beforeEach(() => {
    storage = mockWindowStorage();
  });

  afterEach(() => {
    storage.restore();
  });

  it("returns null when nothing is cached", () => {
    expect(readCachedFileFinderView()).toBeNull();
  });

  it("round-trips a persisted view", () => {
    writeCachedFileFinderView("tree");
    expect(storage.store.get(FILE_FINDER_VIEW_STORAGE_KEY)).toBe("tree");
    expect(readCachedFileFinderView()).toBe("tree");

    writeCachedFileFinderView("list");
    expect(readCachedFileFinderView()).toBe("list");
  });

  it("ignores unrecognized stored values", () => {
    storage.store.set(FILE_FINDER_VIEW_STORAGE_KEY, "bogus");
    expect(readCachedFileFinderView()).toBeNull();
  });
});
