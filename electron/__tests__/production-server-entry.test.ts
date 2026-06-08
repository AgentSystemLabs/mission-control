import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveProductionServerEntry } from "../production-server-entry";

describe("resolveProductionServerEntry", () => {
  it("resolves the server entry from the packaged app.asar root", () => {
    const appPath = path.join(
      "/Applications",
      "MissionControl.app",
      "Contents",
      "Resources",
      "app.asar",
    );
    const expectedEntry = path.join(appPath, "dist", "server", "server.js");

    const { entry, checkedPaths } = resolveProductionServerEntry({
      appPath,
      resourcesPath: path.dirname(appPath),
      mainDirname: path.join(appPath, "dist-electron", "electron"),
      exists: (filePath) => filePath === expectedEntry,
    });

    expect(entry).toBe(expectedEntry);
    expect(checkedPaths).not.toContain(
      path.join(appPath, "dist-electron", "dist", "server", "server.js"),
    );
  });

  it("falls back to the repo dist server when running the production server locally", () => {
    const repoRoot = path.join("/tmp", "mission-control");
    const expectedEntry = path.join(repoRoot, "dist", "server", "server.js");

    const { entry } = resolveProductionServerEntry({
      appPath: path.join(repoRoot, "dist-electron", "electron"),
      resourcesPath: repoRoot,
      mainDirname: path.join(repoRoot, "dist-electron", "electron"),
      exists: (filePath) => filePath === expectedEntry,
    });

    expect(entry).toBe(expectedEntry);
  });

  it("keeps a legacy dist-server fallback for stale local artifacts", () => {
    const repoRoot = path.join("/tmp", "mission-control");
    const expectedEntry = path.join(repoRoot, "dist-server", "server", "server.js");

    const { entry } = resolveProductionServerEntry({
      appPath: path.join(repoRoot, "dist-electron", "electron"),
      resourcesPath: repoRoot,
      mainDirname: path.join(repoRoot, "dist-electron", "electron"),
      exists: (filePath) => filePath === expectedEntry,
    });

    expect(entry).toBe(expectedEntry);
  });
});
