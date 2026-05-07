import {
  clearLicense,
  getLicenseState,
  setLicenseKey,
  setLicenseValidationResult,
  type StoredLicenseState,
} from "~/db/settings";
import { ACADEMY_BASE_URL } from "~/shared/academy";
import {
  isGraceExpired,
  maskLicenseKey,
  type LicenseState,
  type LicenseStatus,
} from "~/shared/license";

type AcademyValidateResponse = {
  status: LicenseStatus;
  plan?: string;
};

/**
 * Academy returns { valid, tier, userId, revoked }. Adapt it to the
 * { status, plan } shape this service stores.
 */
function parseAcademyResponse(value: unknown): AcademyValidateResponse | null {
  if (!value || typeof value !== "object") return null;
  const v = value as {
    valid?: unknown;
    tier?: unknown;
    revoked?: unknown;
  };
  if (typeof v.valid !== "boolean" || typeof v.revoked !== "boolean") {
    return null;
  }
  const plan = typeof v.tier === "string" ? v.tier : undefined;
  if (v.revoked) return { status: "revoked", plan };
  if (v.valid) return { status: "active", plan };
  return { status: "invalid" };
}

export function readLicenseState(): LicenseState {
  return toLicenseState(getLicenseState());
}

function toLicenseState(stored: StoredLicenseState): LicenseState {
  return {
    hasKey: !!stored.key,
    maskedKey: stored.key ? maskLicenseKey(stored.key) : null,
    status: stored.status,
    plan: stored.plan,
    lastValidatedAt: stored.lastValidatedAt,
    graceUntil: stored.graceUntil,
  };
}

/**
 * Persist the key, hit academy, persist the result.
 *
 * Network/parse failures are recorded as status="unknown" and do NOT touch
 * the existing offline grace window — see settings.setLicenseValidationResult.
 */
export async function validateLicense(key: string): Promise<LicenseState> {
  const trimmed = key.trim();
  setLicenseKey(trimmed);

  let result: AcademyValidateResponse | null = null;
  try {
    const res = await fetch(`${ACADEMY_BASE_URL}/api/licenses/validate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ key: trimmed }),
    });
    if (res.ok) {
      const json = await res.json().catch(() => null);
      result = parseAcademyResponse(json);
    } else if (res.status === 404 || res.status === 400) {
      result = { status: "invalid" };
    } else {
      console.warn("[license/validate] non-2xx from academy:", res.status);
    }
  } catch (err) {
    console.error("[license/validate] fetch failed:", err);
  }

  if (result?.status === "invalid") {
    // Don't persist a key academy rejected — drop it so the badge stays Lite.
    clearLicense();
    return { ...readLicenseState(), status: "invalid" };
  }
  if (result) {
    setLicenseValidationResult(result.status, result.plan ?? null);
  } else {
    setLicenseValidationResult("unknown", null);
  }

  return readLicenseState();
}

export function removeLicense(): LicenseState {
  clearLicense();
  return readLicenseState();
}

/**
 * Boot-time silent re-validation. Caller already checked that a key exists.
 * Errors are swallowed; the returned state reflects whatever was persisted.
 */
export async function revalidateOnBoot(): Promise<LicenseState> {
  const stored = getLicenseState();
  if (!stored.key) return toLicenseState(stored);
  return validateLicense(stored.key);
}

export { isGraceExpired };
