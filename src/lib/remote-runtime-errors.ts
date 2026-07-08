import { ApiError } from "~/lib/api";
import { errMsg } from "~/shared/err-msg";
import {
  HTTP_PAYMENT_REQUIRED,
  HTTP_SERVICE_UNAVAILABLE,
  HTTP_TOO_MANY_REQUESTS,
  HTTP_UNAUTHORIZED,
} from "~/shared/http-status";

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
    if (error.status === HTTP_UNAUTHORIZED) {
      return "Academy entitlement is required before hosted runtime can start.";
    }
    if (error.status === HTTP_PAYMENT_REQUIRED) {
      return error.message || "Hosted compute limit reached. Open Academy billing to upgrade or wait for the usage window to reset.";
    }
    if (error.status === HTTP_SERVICE_UNAVAILABLE) {
      return error.message || "Hosted remote runtime is temporarily disabled. Try again later or contact support.";
    }
    if (error.status === HTTP_TOO_MANY_REQUESTS) {
      return `Too many remote ${noun} starts. Wait a minute, then retry.`;
    }
  }
  return errMsg(error ?? "unknown error");
}
