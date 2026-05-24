import { describe, it, expect } from "vitest";
import { matchBinding, eventToBinding, bindingComboKey, bindingsEqual, isValidBinding, matchPinnedSlotBinding, matchAnyPinnedSlot } from "../match";
import { DEFAULT_BINDINGS } from "../defaults";
import { HOTKEY_ACTIONS } from "../types";

function ev(init: { key: string; metaKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean; altKey?: boolean }): KeyboardEvent {
  return {
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    ...init,
  } as unknown as KeyboardEvent;
}

describe("matchBinding", () => {
  it("matches every default binding against an event built from it", () => {
    for (const action of HOTKEY_ACTIONS) {
      const b = DEFAULT_BINDINGS[action];
      const e = ev({ metaKey: b.mod, shiftKey: b.shift, altKey: b.alt, key: b.key });
      expect(matchBinding(e, b)).toBe(true);
    }
  });

  it("rejects when modifiers differ", () => {
    const b = DEFAULT_BINDINGS["agent.new"];
    expect(matchBinding(ev({ key: b.key }), b)).toBe(false);
  });

  it("treats Shift+~ as a match for `", () => {
    expect(
      matchBinding(ev({ metaKey: true, shiftKey: false, key: "~" }), { mod: true, shift: false, alt: false, key: "`" }),
    ).toBe(true);
  });

  it("treats Shift+} as a match for ] with shift", () => {
    expect(
      matchBinding(ev({ metaKey: true, shiftKey: true, key: "}" }), { mod: true, shift: true, alt: false, key: "]" }),
    ).toBe(true);
  });

  it("matches pinned slots that share modifiers with the slot-1 binding", () => {
    const base = { mod: true, shift: false, alt: false, key: "1" };
    expect(matchPinnedSlotBinding(ev({ metaKey: true, key: "3" }), base, 3)).toBe(true);
    expect(matchAnyPinnedSlot(ev({ metaKey: true, key: "2" }), base)).toBe(2);
  });

  it("is case-insensitive for letter keys", () => {
    const b = { mod: true, shift: false, alt: false, key: "n" };
    expect(matchBinding(ev({ metaKey: true, key: "N" }), b)).toBe(true);
  });
});

describe("eventToBinding", () => {
  it("ignores lone modifier keys", () => {
    expect(eventToBinding(ev({ key: "Meta", metaKey: true }))).toBeNull();
  });

  it("captures Cmd+Shift+P", () => {
    const b = eventToBinding(ev({ metaKey: true, shiftKey: true, key: "P" }));
    expect(b).toEqual({ mod: true, shift: true, alt: false, key: "p" });
  });
});

describe("isValidBinding", () => {
  it("requires Cmd/Ctrl", () => {
    expect(isValidBinding({ mod: false, shift: false, alt: false, key: "n" }).ok).toBe(false);
  });
  it("accepts a valid mod+key", () => {
    expect(isValidBinding({ mod: true, shift: false, alt: false, key: "n" }).ok).toBe(true);
  });
});

describe("bindingComboKey + bindingsEqual", () => {
  it("treats the same combo as equal regardless of key casing", () => {
    const a = { mod: true, shift: false, alt: false, key: "N" };
    const b = { mod: true, shift: false, alt: false, key: "n" };
    expect(bindingComboKey(a)).toBe(bindingComboKey(b));
    expect(bindingsEqual(a, b)).toBe(true);
  });
});
