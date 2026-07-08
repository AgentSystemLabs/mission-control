import type { ScreenshotCaptureResult } from "~/shared/electron-contract";

/** User-facing toast copy for a failed native screenshot capture. */
export function screenshotCaptureErrorMessage(error: string): string {
  switch (error) {
    case "screen-permission":
      return "Enable Screen Recording for Mission Control in System Settings › Privacy & Security › Screen Recording.";
    case "unsupported":
      return "Screenshots are only available on macOS.";
    default:
      return "Screenshot capture failed.";
  }
}

/** Narrow a capture result to the fields the floating thumbnail needs. */
export function screenshotFromResult(
  result: ScreenshotCaptureResult,
): { path: string; previewDataUrl: string } | null {
  return "path" in result ? { path: result.path, previewDataUrl: result.previewDataUrl } : null;
}
