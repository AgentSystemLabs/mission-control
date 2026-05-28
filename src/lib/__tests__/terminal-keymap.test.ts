import { describe, expect, it } from "vitest";
import {
  mapTerminalKey,
  shouldSuppressTerminalKey,
  terminalClipboardAction,
} from "../terminal-keymap";

function keyEvent(overrides: Partial<KeyboardEvent>): KeyboardEvent {
  return {
    type: "keydown",
    key: "",
    code: "",
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

describe("terminal clipboard chords", () => {
  it("maps Ctrl+Shift+C to copy and Ctrl+Shift+V to paste", () => {
    expect(
      terminalClipboardAction(keyEvent({ ctrlKey: true, shiftKey: true, code: "KeyC", key: "C" })),
    ).toBe("copy");
    expect(
      terminalClipboardAction(keyEvent({ ctrlKey: true, shiftKey: true, code: "KeyV", key: "V" })),
    ).toBe("paste");
  });

  it("maps Ctrl+Insert to copy and Shift+Insert to paste", () => {
    expect(terminalClipboardAction(keyEvent({ ctrlKey: true, key: "Insert", code: "Insert" }))).toBe(
      "copy",
    );
    expect(terminalClipboardAction(keyEvent({ shiftKey: true, key: "Insert", code: "Insert" }))).toBe(
      "paste",
    );
  });

  it("matches the chord on keyup too so xterm never sees a stray byte", () => {
    expect(
      terminalClipboardAction(
        keyEvent({ type: "keyup", ctrlKey: true, shiftKey: true, code: "KeyC", key: "C" }),
      ),
    ).toBe("copy");
  });

  it("leaves macOS Cmd+C / Cmd+V to the OS menu (metaKey excluded)", () => {
    expect(terminalClipboardAction(keyEvent({ metaKey: true, code: "KeyC", key: "c" }))).toBeNull();
    expect(terminalClipboardAction(keyEvent({ metaKey: true, code: "KeyV", key: "v" }))).toBeNull();
  });

  it("does not hijack plain Ctrl+C (SIGINT) or plain Ctrl+V (quoted insert)", () => {
    expect(terminalClipboardAction(keyEvent({ ctrlKey: true, code: "KeyC", key: "c" }))).toBeNull();
    expect(terminalClipboardAction(keyEvent({ ctrlKey: true, code: "KeyV", key: "v" }))).toBeNull();
  });

  it("ignores Ctrl+Shift with other letters and Alt combos", () => {
    expect(
      terminalClipboardAction(keyEvent({ ctrlKey: true, shiftKey: true, code: "KeyX", key: "X" })),
    ).toBeNull();
    expect(
      terminalClipboardAction(
        keyEvent({ ctrlKey: true, shiftKey: true, altKey: true, code: "KeyC", key: "C" }),
      ),
    ).toBeNull();
  });
});
