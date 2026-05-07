export type LicenseStatus = "active" | "revoked" | "invalid" | "unknown";

export type LicenseState = {
  hasKey: boolean;
  maskedKey: string | null;
  status: LicenseStatus | null;
  plan: string | null;
  lastValidatedAt: string | null;
  graceUntil: string | null;
};

export const GRACE_WINDOW_DAYS = 14;

export const FREE_PROJECT_CAP = 2;

export function maskLicenseKey(key: string): string {
  const trimmed = key.trim();
  if (trimmed.length <= 4) return "•".repeat(trimmed.length);
  return `${"•".repeat(Math.max(4, trimmed.length - 4))}${trimmed.slice(-4)}`;
}

/**
 * True when the user previously had an active license but the offline grace
 * window has expired without a fresh successful validation.
 */
export function isGraceExpired(
  state: Pick<LicenseState, "hasKey" | "status" | "graceUntil">,
  now: Date = new Date(),
): boolean {
  if (!state.hasKey) return false;
  if (!state.graceUntil) return false;
  if (state.status === "revoked" || state.status === "invalid") return false;
  return new Date(state.graceUntil).getTime() < now.getTime();
}

/**
 * Source of truth for "is this user entitled to Pro features right now?"
 * Used by the project-cap gate (UI + server) and the badge/tier UI.
 */
export function isProTier(
  state: Pick<LicenseState, "hasKey" | "status" | "graceUntil">,
  now: Date = new Date(),
): boolean {
  if (!state.hasKey) return false;
  if (state.status !== "active") return false;
  if (isGraceExpired(state, now)) return false;
  return true;
}
