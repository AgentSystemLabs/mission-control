import { ApiError } from "~/lib/api";

/**
 * Human-readable message for a failed hosted remote start. Only the 429
 * (rate-limit) copy varies by caller — `noun` selects "remote runtime starts"
 * vs "remote terminal starts"; every other status is identical.
 */
export function remoteStartErrorMessage(
  error: unknown,
  noun: "runtime" | "terminal" = "runtime",
): string {
  if (error instanceof ApiError) {
    if (error.status === 401) {
      return "Academy entitlement is required before hosted runtime can start.";
    }
    if (error.status === 402) {
      return error.message || "Hosted compute limit reached. Open Academy billing to upgrade or wait for the usage window to reset.";
    }
    if (error.status === 503) {
      return error.message || "Hosted remote runtime is temporarily disabled. Try again later or contact support.";
    }
    if (error.status === 429) {
      return `Too many remote ${noun} starts. Wait a minute, then retry.`;
    }
  }
  return error instanceof Error ? error.message : String(error || "unknown error");
}
