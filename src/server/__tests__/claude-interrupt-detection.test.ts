import { describe, expect, it } from "vitest";
import {
  hasClaudeInterruptPrompt,
  hasCodexHookReviewPrompt,
} from "../../../electron/pty-manager";

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

describe("Codex hook review output detection", () => {
  it("detects the prompt Codex prints when managed hooks need approval", () => {
    expect(
      hasCodexHookReviewPrompt(
        "Hooks need review before they can run. Open /hooks to review Mission Control hooks."
      )
    ).toBe(true);
  });
});
