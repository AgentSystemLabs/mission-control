import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Recursive fs.watch is macOS/Windows-only; on Linux the watcher no-ops, so the
// "starts a watcher" cases are skipped there (the gating cases still hold).
const RECURSIVE = process.platform === "darwin" || process.platform === "win32";

const startGraphIndex = vi.fn();
const isGraphIndexRunning = vi.fn();
const findProjectById = vi.fn();
const readRecallSettings = vi.fn();

let capturedListener: ((event: string, filename: string) => void) | null = null;
const fakeWatcher = { close: vi.fn() };
const watch = vi.fn((_root: unknown, _opts: unknown, listener: (e: string, f: string) => void) => {
  capturedListener = listener;
  return fakeWatcher;
});

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, watch: (...a: unknown[]) => watch(...(a as [unknown, unknown, never])) };
});
vi.mock("../code-graph-indexer", () => ({
  startGraphIndex: (...a: unknown[]) => startGraphIndex(...a),
  isGraphIndexRunning: (...a: unknown[]) => isGraphIndexRunning(...a),
}));
vi.mock("../../repositories/projects.repo", () => ({
  findProjectById: (...a: unknown[]) => findProjectById(...a),
}));
vi.mock("../recall-settings", () => ({
  readRecallSettings: (...a: unknown[]) => readRecallSettings(...a),
}));

const {
  ensureGraphWatch,
  stopGraphWatch,
  __isWatching,
  GRAPH_WATCH_DEBOUNCE_MS,
  GRAPH_WATCH_IDLE_TTL_MS,
} = await import("../graph-watcher");

describe("graph watcher", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedListener = null;
    vi.useFakeTimers();
    readRecallSettings.mockReturnValue({ codeGraphEnabled: true });
    findProjectById.mockReturnValue({ id: "p1", path: "/tmp/proj", sandboxId: null });
    isGraphIndexRunning.mockReturnValue(false);
  });

  afterEach(() => {
    stopGraphWatch("p1");
    vi.useRealTimers();
  });

  it("does not watch when the code-graph setting is off", () => {
    readRecallSettings.mockReturnValue({ codeGraphEnabled: false });
    ensureGraphWatch("p1");
    expect(__isWatching("p1")).toBe(false);
  });

  it("does not watch a sandboxed project", () => {
    findProjectById.mockReturnValue({ id: "p1", path: "/tmp/proj", sandboxId: "sbx" });
    ensureGraphWatch("p1");
    expect(__isWatching("p1")).toBe(false);
  });

  it.skipIf(!RECURSIVE)("fires an incremental build on a debounced source change", () => {
    ensureGraphWatch("p1");
    expect(__isWatching("p1")).toBe(true);
    expect(watch).toHaveBeenCalledTimes(1);

    capturedListener!("change", "src/foo.ts");
    vi.advanceTimersByTime(GRAPH_WATCH_DEBOUNCE_MS);
    expect(startGraphIndex).toHaveBeenCalledWith("p1", "incremental");
  });

  it.skipIf(!RECURSIVE)("ignores changes under ignored dirs and non-source files", () => {
    ensureGraphWatch("p1");
    capturedListener!("change", "node_modules/pkg/index.js");
    capturedListener!("change", "src/readme.md");
    capturedListener!("change", "dist/bundle.js");
    vi.advanceTimersByTime(GRAPH_WATCH_DEBOUNCE_MS + 500);
    expect(startGraphIndex).not.toHaveBeenCalled();
  });

  it.skipIf(!RECURSIVE)("coalesces a burst of changes into a single build", () => {
    ensureGraphWatch("p1");
    capturedListener!("change", "src/a.ts");
    vi.advanceTimersByTime(1000);
    capturedListener!("change", "src/b.ts");
    vi.advanceTimersByTime(GRAPH_WATCH_DEBOUNCE_MS);
    expect(startGraphIndex).toHaveBeenCalledTimes(1);
  });

  it.skipIf(!RECURSIVE)("defers instead of overlapping when a build is already running", () => {
    ensureGraphWatch("p1");
    isGraphIndexRunning.mockReturnValue(true);
    capturedListener!("change", "src/a.ts");
    vi.advanceTimersByTime(GRAPH_WATCH_DEBOUNCE_MS);
    expect(startGraphIndex).not.toHaveBeenCalled(); // deferred until graph:indexed
  });

  it.skipIf(!RECURSIVE)("re-arms the idle timer and stops the watcher when quiet", () => {
    ensureGraphWatch("p1");
    expect(__isWatching("p1")).toBe(true);
    vi.advanceTimersByTime(GRAPH_WATCH_IDLE_TTL_MS);
    expect(__isWatching("p1")).toBe(false);
    expect(fakeWatcher.close).toHaveBeenCalled();
  });

  it.skipIf(!RECURSIVE)("does not open a second watcher when already watching", () => {
    ensureGraphWatch("p1");
    ensureGraphWatch("p1");
    expect(watch).toHaveBeenCalledTimes(1);
  });
});
