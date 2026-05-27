import { describe, expect, it } from "vitest";
import { terminalZoomStepFromKeyboard } from "~/lib/terminal-pane-helpers";

function keyEvent(init: Partial<KeyboardEvent> & Pick<KeyboardEvent, "key">): KeyboardEvent {
  return {
    type: "keydown",
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    code: "",
    ...init,
  } as KeyboardEvent;
}

describe("terminalZoomStepFromKeyboard", () => {
  it("detects mod+= and mod++ as zoom in", () => {
    expect(terminalZoomStepFromKeyboard(keyEvent({ metaKey: true, key: "=" }))).toBe(1);
    expect(terminalZoomStepFromKeyboard(keyEvent({ metaKey: true, key: "+" }))).toBe(1);
    expect(terminalZoomStepFromKeyboard(keyEvent({ ctrlKey: true, key: "=", code: "Equal" }))).toBe(
      1,
    );
  });

  it("detects mod+- as zoom out", () => {
    expect(terminalZoomStepFromKeyboard(keyEvent({ metaKey: true, key: "-" }))).toBe(-1);
    expect(terminalZoomStepFromKeyboard(keyEvent({ ctrlKey: true, key: "-", code: "Minus" }))).toBe(
      -1,
    );
  });

  it("ignores unmodified or alt-modified keys", () => {
    expect(terminalZoomStepFromKeyboard(keyEvent({ key: "=" }))).toBeNull();
    expect(terminalZoomStepFromKeyboard(keyEvent({ metaKey: true, altKey: true, key: "=" }))).toBeNull();
    expect(terminalZoomStepFromKeyboard(keyEvent({ metaKey: true, key: "k" }))).toBeNull();
  });
});
