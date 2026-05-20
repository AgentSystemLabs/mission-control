import { describe, expect, it } from "vitest";
import { getPinnedProjectStatusDots } from "../project-bar-status-dots";

describe("getPinnedProjectStatusDots", () => {
  it("fills the four-dot list with running sessions before finished sessions", () => {
    expect(getPinnedProjectStatusDots({ running: 2, finished: 4 })).toEqual([
      "running",
      "running",
      "finished",
      "finished",
    ]);
  });

  it("reserves all slots for running sessions when there are more than four", () => {
    expect(getPinnedProjectStatusDots({ running: 5, finished: 3 })).toEqual([
      "running",
      "running",
      "running",
      "running",
    ]);
  });

  it("shows finished sessions when there are no running sessions", () => {
    expect(getPinnedProjectStatusDots({ running: 0, finished: 6 })).toEqual([
      "finished",
      "finished",
      "finished",
      "finished",
    ]);
  });
});
