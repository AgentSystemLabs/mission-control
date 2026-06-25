import { describe, expect, it } from "vitest";
import {
  MICROPHONE_WEB_PERMISSION,
  NOTIFICATION_WEB_PERMISSION,
  shouldAllowAudioCapture,
  shouldAllowWebPermission,
} from "../notification-permissions";

describe("shouldAllowWebPermission", () => {
  it("allows notification permission requests", () => {
    expect(shouldAllowWebPermission(NOTIFICATION_WEB_PERMISSION)).toBe(true);
  });

  it("denies bare media (microphone is gated separately by media type)", () => {
    expect(shouldAllowWebPermission(MICROPHONE_WEB_PERMISSION)).toBe(false);
  });

  it("denies other web permission requests", () => {
    expect(shouldAllowWebPermission("geolocation")).toBe(false);
    expect(shouldAllowWebPermission("clipboard-read")).toBe(false);
  });
});

describe("shouldAllowAudioCapture", () => {
  it("allows audio-only media requests", () => {
    expect(shouldAllowAudioCapture(["audio"])).toBe(true);
  });

  it("rejects camera / mixed / empty / missing requests", () => {
    expect(shouldAllowAudioCapture(["video"])).toBe(false);
    expect(shouldAllowAudioCapture(["audio", "video"])).toBe(false);
    expect(shouldAllowAudioCapture([])).toBe(false);
    expect(shouldAllowAudioCapture(undefined)).toBe(false);
  });
});
