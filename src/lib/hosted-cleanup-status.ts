import { getClientRuntime } from "./runtime";

export type HostedCleanupStatusScope =
  | "session"
  | "project"
  | "finishedSessions"
  | "disconnectedSessions";

const HOSTED_CLEANUP_STATUS: Record<HostedCleanupStatusScope, string> = {
  session:
    "Cleaning up hosted resources for this session. If the hosted environment is unavailable, cleanup will be retried.",
  project:
    "Cleaning up hosted resources for this project. If the hosted environment is unavailable, cleanup will be queued for retry.",
  finishedSessions: "Cleaning up hosted resources for finished sessions.",
  disconnectedSessions: "Cleaning up hosted resources for disconnected sessions.",
};

export function hostedCleanupStatusForCurrentRuntime(
  scope: HostedCleanupStatusScope,
): string | null {
  return getClientRuntime() === "web-daytona" ? HOSTED_CLEANUP_STATUS[scope] : null;
}
