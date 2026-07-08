import { getElectron } from "~/lib/electron";
import type { ScreenshotCaptureResult } from "~/shared/electron-contract";

/**
 * Native screenshot capture is macOS-only (uses `screencapture -i`) and needs
 * the Electron bridge. Everything screenshot-related — the capture button, the
 * floating capture stack, and the persistent history strip — is gated on this,
 * so on other platforms nothing is shown, and history isn't even loaded from
 * disk. Gate on the main process's authoritative platform, not navigator.platform.
 */
export function screenshotSupported(): boolean {
  return getElectron()?.platform === "darwin";
}

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
