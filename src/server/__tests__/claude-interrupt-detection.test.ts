import { describe, expect, it } from "vitest";
import {
  hasClaudeInterruptPrompt,
  hasCodexHookReviewPrompt,
  hasGrokInterruptPrompt,
  isGrokInterruptInput,
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

describe("Grok Build interrupt output detection", () => {
  it("recognizes the native cancelled-turn marker through terminal styling", () => {
    expect(
      hasGrokInterruptPrompt("\u001b[31mTurn cancelled\u001b[0m by user in 1.2s."),
    ).toBe(true);
  });

  it("does not mistake ordinary cancellation text for a turn interrupt", () => {
    expect(hasGrokInterruptPrompt("File upload cancelled.")).toBe(false);
  });

  it("uses Ctrl+C as an immediate fallback without treating standalone Esc as proof", () => {
    expect(isGrokInterruptInput("\x03")).toBe(true);
    expect(isGrokInterruptInput("\x1b")).toBe(false);
    expect(isGrokInterruptInput("\x1b[A")).toBe(false);
  });
});
