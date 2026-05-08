export type LicenseStatus = "active" | "invalid";

export type LicensePayload = {
  licenseId: string;
  customerId: string;
  product: "mission-control-pro";
  tier: "pro";
  expiresAt: string | null;
  maxMachines: number;
  issuedAt: string;
};

export type LicenseState = {
  hasKey: boolean;
  maskedKey: string | null;
  status: LicenseStatus | null;
  plan: string | null;
  lastValidatedAt: string | null;
  payload: LicensePayload | null;
};

export const FREE_PROJECT_CAP = 2;

export function isLicensePayloadExpired(
  payload: Pick<LicensePayload, "expiresAt">,
  now: Date = new Date(),
): boolean {
  if (!payload.expiresAt) return false;
  return new Date(payload.expiresAt).getTime() < now.getTime();
}

export function maskLicenseKey(key: string): string {
  const trimmed = key.trim();
  if (trimmed.length <= 4) return "•".repeat(trimmed.length);
  return `${"•".repeat(Math.min(12, Math.max(4, trimmed.length - 4)))}${trimmed.slice(-4)}`;
}

/**
 * Source of truth for "is this user entitled to Pro features right now?"
 * Used by the project-cap gate (UI + server) and the badge/tier UI.
 */
export function isProTier(
  state: Pick<LicenseState, "hasKey" | "status">,
): boolean {
  if (!state.hasKey) return false;
  return state.status === "active";
}
