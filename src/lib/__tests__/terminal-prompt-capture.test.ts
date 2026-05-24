import { describe, expect, it } from "vitest";
import { accumulateTerminalPrompt } from "../terminal-prompt-capture";

describe("accumulateTerminalPrompt", () => {
  it("submits buffered text on enter", () => {
    let state = accumulateTerminalPrompt("", "fix ").buffer;
    state = accumulateTerminalPrompt(state, "login\r").buffer;
    expect(state).toBe("");

    const submitted = accumulateTerminalPrompt("fix login", "\r");
    expect(submitted).toEqual({ buffer: "", submitted: "fix login" });
  });

  it("handles backspace before submit", () => {
    const result = accumulateTerminalPrompt("", "ship\x7f it\r");
    expect(result).toEqual({ buffer: "", submitted: "shi it" });
  });

  it("ignores escape sequences from arrow keys", () => {
    const result = accumulateTerminalPrompt("", "hello\x1b[A world\r");
    expect(result).toEqual({ buffer: "", submitted: "hello world" });
  });
});
