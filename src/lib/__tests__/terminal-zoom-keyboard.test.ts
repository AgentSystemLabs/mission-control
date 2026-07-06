import { describe, expect, it } from "vitest";
import { terminalZoomIntentFromKeyboard } from "~/lib/terminal-pane-helpers";

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

describe("terminalZoomIntentFromKeyboard", () => {
  it("detects mod+= and mod++ as zoom in", () => {
    expect(terminalZoomIntentFromKeyboard(keyEvent({ metaKey: true, key: "=" }))).toBe("in");
    expect(terminalZoomIntentFromKeyboard(keyEvent({ metaKey: true, key: "+" }))).toBe("in");
    expect(
      terminalZoomIntentFromKeyboard(keyEvent({ ctrlKey: true, key: "=", code: "Equal" })),
    ).toBe("in");
  });

  it("detects mod+- as zoom out", () => {
    expect(terminalZoomIntentFromKeyboard(keyEvent({ metaKey: true, key: "-" }))).toBe("out");
    expect(
      terminalZoomIntentFromKeyboard(keyEvent({ ctrlKey: true, key: "-", code: "Minus" })),
    ).toBe("out");
  });

  it("detects mod+0 as reset", () => {
    expect(terminalZoomIntentFromKeyboard(keyEvent({ metaKey: true, key: "0" }))).toBe("reset");
    expect(
      terminalZoomIntentFromKeyboard(keyEvent({ ctrlKey: true, key: "0", code: "Digit0" })),
    ).toBe("reset");
  });

  it("ignores unmodified or alt-modified keys", () => {
    expect(terminalZoomIntentFromKeyboard(keyEvent({ key: "=" }))).toBeNull();
    expect(terminalZoomIntentFromKeyboard(keyEvent({ key: "0" }))).toBeNull();
    expect(
      terminalZoomIntentFromKeyboard(keyEvent({ metaKey: true, altKey: true, key: "=" })),
    ).toBeNull();
    expect(terminalZoomIntentFromKeyboard(keyEvent({ metaKey: true, key: "k" }))).toBeNull();
  });
});
