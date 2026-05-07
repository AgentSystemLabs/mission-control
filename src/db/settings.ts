import { eq } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { getDb } from "./client";
import { appSettings } from "./schema";
import {
  GRACE_WINDOW_DAYS,
  type LicenseStatus,
} from "~/shared/license";

export function getSetting(key: string): string | null {
  const db = getDb();
  const row = db.select().from(appSettings).where(eq(appSettings.key, key)).get();
  return row?.value ?? null;
}

export function setSetting(key: string, value: string): void {
  const db = getDb();
  db.insert(appSettings)
    .values({ key, value })
    .onConflictDoUpdate({ target: appSettings.key, set: { value } })
    .run();
}

export function getBooleanSetting(key: string, defaultValue = false): boolean {
  const value = getSetting(key);
  if (value === null) return defaultValue;
  return value === "true";
}

export function setBooleanSetting(key: string, value: boolean): void {
  setSetting(key, value ? "true" : "false");
}

export function getOrCreateApiToken(): string {
  let token = getSetting("api_token");
  if (!token) {
    token = randomBytes(32).toString("hex");
    setSetting("api_token", token);
  }
  return token;
}

export function regenerateApiToken(): string {
  const token = randomBytes(32).toString("hex");
  setSetting("api_token", token);
  return token;
}

const LICENSE_KEY_KEY = "license_key";
const LICENSE_STATUS_KEY = "license_status";
const LICENSE_PLAN_KEY = "license_plan";
const LICENSE_LAST_VALIDATED_AT_KEY = "license_last_validated_at";
const LICENSE_OFFLINE_GRACE_UNTIL_KEY = "license_offline_grace_until";

const LICENSE_STATUS_VALUES: readonly LicenseStatus[] = [
  "active",
  "revoked",
  "invalid",
  "unknown",
];

function readLicenseStatus(): LicenseStatus | null {
  const raw = getSetting(LICENSE_STATUS_KEY);
  return LICENSE_STATUS_VALUES.includes(raw as LicenseStatus)
    ? (raw as LicenseStatus)
    : null;
}

export type StoredLicenseState = {
  key: string | null;
  status: LicenseStatus | null;
  plan: string | null;
  lastValidatedAt: string | null;
  graceUntil: string | null;
};

export function getLicenseState(): StoredLicenseState {
  return {
    key: getSetting(LICENSE_KEY_KEY),
    status: readLicenseStatus(),
    plan: getSetting(LICENSE_PLAN_KEY),
    lastValidatedAt: getSetting(LICENSE_LAST_VALIDATED_AT_KEY),
    graceUntil: getSetting(LICENSE_OFFLINE_GRACE_UNTIL_KEY),
  };
}

export function setLicenseKey(key: string): void {
  setSetting(LICENSE_KEY_KEY, key);
}

export function clearLicense(): void {
  const db = getDb();
  for (const key of [
    LICENSE_KEY_KEY,
    LICENSE_STATUS_KEY,
    LICENSE_PLAN_KEY,
    LICENSE_LAST_VALIDATED_AT_KEY,
    LICENSE_OFFLINE_GRACE_UNTIL_KEY,
  ]) {
    db.delete(appSettings).where(eq(appSettings.key, key)).run();
  }
}

/**
 * Persist the result of a license validation attempt.
 * `graceUntil` is only refreshed when the academy returned `active`; other
 * outcomes (including network failures recorded as `unknown`) leave the
 * existing grace window intact so a transient network failure can't
 * accidentally extend Pro access.
 */
export function setLicenseValidationResult(
  status: LicenseStatus,
  plan: string | null,
  now: Date = new Date(),
): void {
  setSetting(LICENSE_STATUS_KEY, status);
  setSetting(LICENSE_LAST_VALIDATED_AT_KEY, now.toISOString());
  if (plan) {
    setSetting(LICENSE_PLAN_KEY, plan);
  } else {
    const db = getDb();
    db.delete(appSettings).where(eq(appSettings.key, LICENSE_PLAN_KEY)).run();
  }
  if (status === "active") {
    const grace = new Date(now.getTime() + GRACE_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    setSetting(LICENSE_OFFLINE_GRACE_UNTIL_KEY, grace.toISOString());
  }
}

const SKILLS_INITIALIZED_AT_KEY = "skills_initialized_at";

export function getSkillsInitializedAt(): string | null {
  return getSetting(SKILLS_INITIALIZED_AT_KEY);
}

export function setSkillsInitializedAt(iso: string): void {
  setSetting(SKILLS_INITIALIZED_AT_KEY, iso);
}
