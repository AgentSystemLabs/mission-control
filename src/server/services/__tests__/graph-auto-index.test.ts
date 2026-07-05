import { beforeEach, describe, expect, it, vi } from "vitest";

// Control all of maybeAutoIndexGraph's collaborators so the test never touches
// the DB, the filesystem, or the real (heavy) indexer.
const findProjectById = vi.fn();
const getGraphStatus = vi.fn();
const startGraphIndex = vi.fn();
const isGraphIndexRunning = vi.fn();
const readRecallSettings = vi.fn();

vi.mock("../../repositories/projects.repo", () => ({
  findProjectById: (...a: unknown[]) => findProjectById(...a),
}));
vi.mock("../code-graph", () => ({
  getGraphStatus: (...a: unknown[]) => getGraphStatus(...a),
}));
vi.mock("../code-graph-indexer", () => ({
  startGraphIndex: (...a: unknown[]) => startGraphIndex(...a),
  isGraphIndexRunning: (...a: unknown[]) => isGraphIndexRunning(...a),
}));
vi.mock("../recall-settings", () => ({
  readRecallSettings: (...a: unknown[]) => readRecallSettings(...a),
}));

const { maybeAutoIndexGraph, __resetAutoIndexCooldown } = await import("../graph-auto-index");

const PROJECT = "proj-1";

describe("maybeAutoIndexGraph", () => {
  beforeEach(() => {
    __resetAutoIndexCooldown();
    vi.clearAllMocks();
    // Defaults: enabled, local project, not running, not yet indexed.
    readRecallSettings.mockReturnValue({ codeGraphEnabled: true });
    findProjectById.mockReturnValue({ id: PROJECT, path: "/tmp/proj", sandboxId: null });
    isGraphIndexRunning.mockReturnValue(false);
    getGraphStatus.mockReturnValue({ indexed: false });
  });

  it("starts a FULL build when the project has never been indexed", () => {
    maybeAutoIndexGraph(PROJECT);
    expect(startGraphIndex).toHaveBeenCalledWith(PROJECT, "full");
  });

  it("starts an INCREMENTAL build when a graph already exists", () => {
    getGraphStatus.mockReturnValue({ indexed: true });
    maybeAutoIndexGraph(PROJECT);
    expect(startGraphIndex).toHaveBeenCalledWith(PROJECT, "incremental");
  });

  it("does nothing when the code-graph setting is off", () => {
    readRecallSettings.mockReturnValue({ codeGraphEnabled: false });
    maybeAutoIndexGraph(PROJECT);
    expect(startGraphIndex).not.toHaveBeenCalled();
  });

  it("does nothing for a sandboxed (non-local) project", () => {
    findProjectById.mockReturnValue({ id: PROJECT, path: "/tmp/proj", sandboxId: "sbx-9" });
    maybeAutoIndexGraph(PROJECT);
    expect(startGraphIndex).not.toHaveBeenCalled();
  });

  it("does nothing when the project is unknown", () => {
    findProjectById.mockReturnValue(null);
    maybeAutoIndexGraph(PROJECT);
    expect(startGraphIndex).not.toHaveBeenCalled();
  });

  it("does nothing while a build is already running", () => {
    isGraphIndexRunning.mockReturnValue(true);
    maybeAutoIndexGraph(PROJECT);
    expect(startGraphIndex).not.toHaveBeenCalled();
  });

  it("collapses repeated triggers within the cooldown window", () => {
    maybeAutoIndexGraph(PROJECT);
    maybeAutoIndexGraph(PROJECT);
    expect(startGraphIndex).toHaveBeenCalledTimes(1);

    __resetAutoIndexCooldown();
    maybeAutoIndexGraph(PROJECT);
    expect(startGraphIndex).toHaveBeenCalledTimes(2);
  });

  it("does not swallow the cooldown slot when the indexer throws", () => {
    startGraphIndex.mockImplementationOnce(() => {
      throw new Error("project path does not exist on disk");
    });
    maybeAutoIndexGraph(PROJECT); // throws internally, cooldown cleared
    // A subsequent valid trigger should still be allowed to retry.
    maybeAutoIndexGraph(PROJECT);
    expect(startGraphIndex).toHaveBeenCalledTimes(2);
  });
});
