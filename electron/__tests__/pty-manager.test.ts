import { describe, expect, it } from "vitest";
import { planLaunchPortKillTargets } from "../pty-manager";

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
