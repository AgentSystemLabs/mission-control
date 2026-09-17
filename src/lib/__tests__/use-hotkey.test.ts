import { afterEach, describe, expect, it } from "vitest";
import { isHotkeySuppressed } from "../use-hotkey";
import { setKeybindingRecording } from "../keybindings/recording";
import { setSettingsOverlayOpen } from "../settings-navigation";

afterEach(() => {
  setKeybindingRecording(false);
  setSettingsOverlayOpen(false);
});

describe("isHotkeySuppressed", () => {
  it("lets hotkeys fire when nothing modal is active", () => {
    expect(isHotkeySuppressed("agent.new", false)).toBe(false);
    expect(isHotkeySuppressed("settings.open", true)).toBe(false);
    expect(isHotkeySuppressed("escape", false)).toBe(false);
  });

  it("suppresses app hotkeys behind the settings overlay unless they opt in", () => {
    setSettingsOverlayOpen(true);
    expect(isHotkeySuppressed("agent.new", false)).toBe(true);
    expect(isHotkeySuppressed("settings.open", true)).toBe(false);
    expect(isHotkeySuppressed("escape", true)).toBe(false);
  });

  // Regression: `settings.open` opts into firing while Settings is open, and its
  // window-capture listener is registered before the recorder's. Without this
  // gate, pressing Cmd/Ctrl+, while recording a binding closed Settings instead
  // of being captured.
  it("suppresses rebindable actions while the keybinding recorder is capturing", () => {
    setSettingsOverlayOpen(true);
    setKeybindingRecording(true);
    expect(isHotkeySuppressed("settings.open", true)).toBe(true);
    expect(isHotkeySuppressed("dialog.submit", true)).toBe(true);
  });

  it("keeps literal targets live while recording so Esc/Enter still work", () => {
    setSettingsOverlayOpen(true);
    setKeybindingRecording(true);
    expect(isHotkeySuppressed("escape", true)).toBe(false);
    expect(isHotkeySuppressed("enter", true)).toBe(false);
  });

  it("releases the suppression once recording stops", () => {
    setSettingsOverlayOpen(true);
    setKeybindingRecording(true);
    setKeybindingRecording(false);
    expect(isHotkeySuppressed("settings.open", true)).toBe(false);
  });
});
