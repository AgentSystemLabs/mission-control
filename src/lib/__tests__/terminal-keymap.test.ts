import { describe, expect, it } from "vitest";
import { mapTerminalKey, shouldSuppressTerminalKey } from "../terminal-keymap";

function keyEvent(overrides: Partial<KeyboardEvent>): KeyboardEvent {
  return {
    type: "keydown",
    key: "",
    shiftKey: false,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    ...overrides,
  } as KeyboardEvent;
}

describe("terminal keymap", () => {
  it("maps Shift+Enter keydown to ESC+CR", () => {
    expect(mapTerminalKey(keyEvent({ key: "Enter", shiftKey: true }))).toBe("\x1b\r");
  });

  it("suppresses the Shift+Enter keypress without writing duplicate bytes", () => {
    const event = keyEvent({ type: "keypress", key: "Enter", shiftKey: true });

    expect(mapTerminalKey(event)).toBeNull();
    expect(shouldSuppressTerminalKey(event)).toBe(true);
  });

  it("does not suppress normal Enter", () => {
    expect(mapTerminalKey(keyEvent({ key: "Enter" }))).toBeNull();
    expect(shouldSuppressTerminalKey(keyEvent({ type: "keypress", key: "Enter" }))).toBe(false);
  });
});
