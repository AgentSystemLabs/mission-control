import { describe, expect, it } from "vitest";
import {
  screenshotCaptureErrorMessage,
  screenshotFromResult,
} from "~/lib/screenshot";
import type { ScreenshotCaptureResult } from "~/shared/electron-contract";

describe("screenshotCaptureErrorMessage", () => {
  it("guides the user to the Screen Recording setting on a permission error", () => {
    expect(screenshotCaptureErrorMessage("screen-permission")).toMatch(
      /Screen Recording/i,
    );
  });

  it("explains the macOS-only limitation", () => {
    expect(screenshotCaptureErrorMessage("unsupported")).toMatch(/macOS/i);
  });

  it("falls back to a generic message for unknown errors", () => {
    expect(screenshotCaptureErrorMessage("boom")).toBe("Screenshot capture failed.");
  });
});

describe("screenshotFromResult", () => {
  it("extracts path + preview from a successful capture", () => {
    const result: ScreenshotCaptureResult = {
      path: "/tmp/terminal-images/shot.png",
      previewDataUrl: "data:image/png;base64,AAAA",
    };
    expect(screenshotFromResult(result)).toEqual({
      path: "/tmp/terminal-images/shot.png",
      previewDataUrl: "data:image/png;base64,AAAA",
    });
  });

  it("returns null for a cancelled capture", () => {
    expect(screenshotFromResult({ cancelled: true })).toBeNull();
  });

  it("returns null for an errored capture", () => {
    expect(screenshotFromResult({ error: "screen-permission" })).toBeNull();
  });
});
