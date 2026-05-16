import {
  clearLicense,
  getLicenseState,
  setLicenseKey,
  setLicensePayload,
  setLicenseValidationResult,
  type StoredLicenseState,
} from "./license-storage";
import {
  isLicensePayloadExpired,
  maskLicenseKey,
  type LicenseState,
} from "~/shared/license";
import { verifySignedLicense } from "./license-crypto";

export function readLicenseState(): LicenseState {
  return toLicenseState(getLicenseState());
}

function toLicenseState(stored: StoredLicenseState): LicenseState {
  const verified = stored.key ? verifySignedLicense(stored.key) : null;
  if (verified && !verified.ok) {
    return {
      hasKey: false,
      maskedKey: null,
      status: "invalid",
      plan: null,
      lastValidatedAt: stored.lastValidatedAt,
      payload: null,
    };
  }
  const payload = verified?.ok ? verified.payload : stored.payload;
  const payloadExpired = payload ? isLicensePayloadExpired(payload) : false;
  return {
    hasKey: !!stored.key,
    maskedKey: stored.key ? maskLicenseKey(stored.key) : null,
    status: payloadExpired ? "invalid" : stored.key ? "active" : stored.status,
    plan: payloadExpired ? null : (stored.plan ?? payload?.tier ?? null),
    lastValidatedAt: stored.lastValidatedAt,
    payload: payloadExpired ? null : (payload ?? null),
  };
}

function persistSignedLicense(key: string): LicenseState | null {
  const verified = verifySignedLicense(key);
  if (!verified.ok) return null;

  setLicenseKey(key);
  setLicensePayload(verified.payload);
  setLicenseValidationResult("active", verified.payload.tier);
  return readLicenseState();
}

/**
 * Persist a locally-verifiable signed license. Academy is not contacted; the
 * signed blob is the entitlement source of truth for desktop Pro unlock.
 */
export async function validateLicense(key: string): Promise<LicenseState> {
  const trimmed = key.trim();
  if (!verifySignedLicense(trimmed).ok) {
    clearLicense();
    return { ...readLicenseState(), status: "invalid" };
  }

  const previous = getLicenseState();
  if (previous.key !== trimmed) clearLicense();
  persistSignedLicense(trimmed);

  return readLicenseState();
}

export function removeLicense(): LicenseState {
  clearLicense();
  return readLicenseState();
}
