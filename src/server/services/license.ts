import {
  isLicensePayloadExpired,
  maskLicenseKey,
  type LicensePayload,
  type LicenseStatus,
  type LicenseState,
} from "~/shared/license";
import { verifySignedLicense } from "./license-crypto";
import { getRepositories, type UserScope } from "../repositories";

const LICENSE_KEY_KEY = "license_key";
const LICENSE_STATUS_KEY = "license_status";
const LICENSE_PLAN_KEY = "license_plan";
const LICENSE_LAST_VALIDATED_AT_KEY = "license_last_validated_at";
const LICENSE_PAYLOAD_KEY = "license_payload";

type StoredLicenseState = {
  key: string | null;
  status: LicenseStatus | null;
  plan: string | null;
  lastValidatedAt: string | null;
  payload: LicensePayload | null;
};

const LICENSE_STATUS_VALUES: readonly LicenseStatus[] = ["active", "invalid"];

export async function readLicenseState(userId?: string | null): Promise<LicenseState> {
  return toLicenseState(await getStoredLicenseState({ userId }));
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

async function getStoredLicenseState(scope?: UserScope): Promise<StoredLicenseState> {
  const settings = getRepositories().settings;
  const rawStatus = await settings.get(LICENSE_STATUS_KEY, scope);
  const rawPayload = await settings.get(LICENSE_PAYLOAD_KEY, scope);
  let payload: LicensePayload | null = null;
  if (rawPayload) {
    try {
      const parsed = JSON.parse(rawPayload) as unknown;
      if (isLicensePayloadShape(parsed)) payload = parsed;
    } catch {
      payload = null;
    }
  }
  return {
    key: await settings.get(LICENSE_KEY_KEY, scope),
    status: LICENSE_STATUS_VALUES.includes(rawStatus as LicenseStatus)
      ? (rawStatus as LicenseStatus)
      : null,
    plan: await settings.get(LICENSE_PLAN_KEY, scope),
    lastValidatedAt: await settings.get(LICENSE_LAST_VALIDATED_AT_KEY, scope),
    payload,
  };
}

function isLicensePayloadShape(v: unknown): v is LicensePayload {
  if (!v || typeof v !== "object") return false;
  const p = v as Record<string, unknown>;
  return (
    p.product === "mission-control-pro" &&
    (p.tier === "pro" || p.tier === "academy" || p.tier === "full_system") &&
    typeof p.licenseId === "string" &&
    typeof p.customerId === "string" &&
    (typeof p.expiresAt === "string" || p.expiresAt === null) &&
    typeof p.maxMachines === "number" &&
    typeof p.issuedAt === "string"
  );
}

async function clearStoredLicense(scope?: UserScope): Promise<void> {
  const settings = getRepositories().settings;
  for (const key of [
    LICENSE_KEY_KEY,
    LICENSE_STATUS_KEY,
    LICENSE_PLAN_KEY,
    LICENSE_LAST_VALIDATED_AT_KEY,
    LICENSE_PAYLOAD_KEY,
    "license_offline_grace_until",
    "license_activation",
  ]) {
    await settings.delete(key, scope);
  }
}

async function persistSignedLicense(key: string, scope?: UserScope): Promise<LicenseState | null> {
  const verified = verifySignedLicense(key);
  if (!verified.ok) return null;

  const settings = getRepositories().settings;
  await settings.set(LICENSE_KEY_KEY, key, scope);
  await settings.set(LICENSE_PAYLOAD_KEY, JSON.stringify(verified.payload), scope);
  await settings.set(LICENSE_STATUS_KEY, "active", scope);
  await settings.set(LICENSE_LAST_VALIDATED_AT_KEY, new Date().toISOString(), scope);
  await settings.set(LICENSE_PLAN_KEY, verified.payload.tier, scope);
  return readLicenseState(scope?.userId);
}

/**
 * Persist a locally-verifiable signed license. Academy is not contacted; the
 * signed blob is the entitlement source of truth for desktop Pro unlock.
 */
export async function validateLicense(key: string, userId?: string | null): Promise<LicenseState> {
  const scope = { userId };
  const trimmed = key.trim();
  if (!verifySignedLicense(trimmed).ok) {
    await clearStoredLicense(scope);
    return { ...(await readLicenseState(userId)), status: "invalid" };
  }

  const previous = await getStoredLicenseState(scope);
  // No-op when the same signed key is re-validated — avoids a needless
  // clear/persist round-trip that could briefly expose `hasKey: false`.
  if (previous.key === trimmed) {
    return readLicenseState(userId);
  }

  await clearStoredLicense(scope);
  await persistSignedLicense(trimmed, scope);

  return readLicenseState(userId);
}

export async function removeLicense(userId?: string | null): Promise<LicenseState> {
  await clearStoredLicense({ userId });
  return readLicenseState(userId);
}
