import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { disposePty, isCwdWithin, planLaunchPortKillTargets } from "../pty-manager";

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

describe("disposePty", () => {
  // Regression guard for the PTY master leak: node-pty's kill() only SIGHUPs the
  // child and leaves the master /dev/ptmx fd open if the child survives the
  // signal. Teardown MUST close the master via destroy(), or a long-lived window
  // exhausts macOS's kern.tty.ptmx_max and every pty spawn on the machine fails.
  it("closes the master fd via destroy() instead of only signalling with kill()", () => {
    const destroy = vi.fn();
    const kill = vi.fn();
    disposePty({ pid: 4242, destroy, kill } as never);
    expect(destroy).toHaveBeenCalledTimes(1);
    expect(kill).not.toHaveBeenCalled();
  });

  it("falls back to kill() only when destroy() is unavailable", () => {
    const kill = vi.fn();
    disposePty({ pid: 4242, kill } as never);
    expect(kill).toHaveBeenCalledTimes(1);
  });

  it("is a no-op for a missing proc and swallows teardown errors", () => {
    expect(() => disposePty(null)).not.toThrow();
    expect(() =>
      disposePty({
        pid: 1,
        destroy: () => {
          throw new Error("already gone");
        },
      } as never),
    ).not.toThrow();
  });
});
