import { describe, expect, it } from "vitest";
import { shouldFlashPinnedProjectLogo } from "../project-bar-activity";

describe("shouldFlashPinnedProjectLogo", () => {
  it("does not flash for an open terminal without a running CLI session", () => {
    expect(
      shouldFlashPinnedProjectLogo({
        cliRunningCount: 0,
        terminalOpen: true,
      })
    ).toBe(false);
  });

  it("flashes when at least one CLI session is running", () => {
    expect(
      shouldFlashPinnedProjectLogo({
        cliRunningCount: 1,
        terminalOpen: false,
      })
    ).toBe(true);
  });
});
