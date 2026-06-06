import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { isCwdWithin, planLaunchPortKillTargets } from "../pty-manager";

describe("planLaunchPortKillTargets", () => {
  it("marks Mission Control runtime ports as protected", () => {
    expect(planLaunchPortKillTargets([5173, 3000], [5173])).toEqual([
      { port: 5173, protected: true },
      { port: 3000, protected: false },
    ]);
  });

  it("dedupes ports and ignores invalid values", () => {
    expect(planLaunchPortKillTargets([5173, 5173, 0, 70000, -1], [3000])).toEqual([
      { port: 5173, protected: false },
    ]);
  });
});

describe("isCwdWithin", () => {
  const root = path.resolve(os.tmpdir(), "proj", ".worktree", "lunar-lunar-autumn");

  it("matches the worktree root itself", () => {
    expect(isCwdWithin(root, root)).toBe(true);
  });

  it("matches a nested cwd inside the worktree", () => {
    expect(isCwdWithin(path.join(root, "packages", "app"), root)).toBe(true);
  });

  it("rejects siblings and the parent project root", () => {
    const sibling = path.resolve(os.tmpdir(), "proj", ".worktree", "amber-forest-mountain");
    expect(isCwdWithin(sibling, root)).toBe(false);
    expect(isCwdWithin(path.resolve(os.tmpdir(), "proj"), root)).toBe(false);
  });

  it("does not match a path that only shares a name prefix", () => {
    expect(isCwdWithin(`${root}-2`, root)).toBe(false);
  });

  it("ignores drive-letter / segment casing on Windows", () => {
    if (os.platform() !== "win32") return;
    expect(isCwdWithin(root.toUpperCase(), root.toLowerCase())).toBe(true);
  });

  it("returns false for empty inputs", () => {
    expect(isCwdWithin("", root)).toBe(false);
    expect(isCwdWithin(root, "")).toBe(false);
  });
});
