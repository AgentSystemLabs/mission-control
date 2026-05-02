import { describe, expect, it } from "vitest";
import { hasClaudeInterruptPrompt } from "../../../electron/pty-manager";

describe("Claude interrupt output detection", () => {
  it("detects the current Esc interrupt prompt", () => {
    expect(
      hasClaudeInterruptPrompt(
        "Interrupted · What should Claude do instead?"
      )
    ).toBe(true);
  });

  it("detects the legacy interrupt marker", () => {
    expect(hasClaudeInterruptPrompt("Interrupted by user")).toBe(true);
  });
});
