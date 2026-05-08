import { eq } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { getDb } from "./client";
import { appSettings } from "./schema";
import {
  type LicensePayload,
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

function deleteSetting(key: string): void {
  const db = getDb();
  db.delete(appSettings).where(eq(appSettings.key, key)).run();
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
const LICENSE_PAYLOAD_KEY = "license_payload";

const LICENSE_STATUS_VALUES: readonly LicenseStatus[] = [
  "active",
  "invalid",
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
  payload: LicensePayload | null;
};

function readJsonSetting<T>(key: string): T | null {
  const raw = getSetting(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function getLicenseState(): StoredLicenseState {
  return {
    key: getSetting(LICENSE_KEY_KEY),
    status: readLicenseStatus(),
    plan: getSetting(LICENSE_PLAN_KEY),
    lastValidatedAt: getSetting(LICENSE_LAST_VALIDATED_AT_KEY),
    payload: readJsonSetting<LicensePayload>(LICENSE_PAYLOAD_KEY),
  };
}

export function setLicenseKey(key: string): void {
  setSetting(LICENSE_KEY_KEY, key);
}

export function clearLicense(): void {
  for (const key of [
    LICENSE_KEY_KEY,
    LICENSE_STATUS_KEY,
    LICENSE_PLAN_KEY,
    LICENSE_LAST_VALIDATED_AT_KEY,
    LICENSE_PAYLOAD_KEY,
    "license_offline_grace_until",
    "license_activation",
  ]) {
    deleteSetting(key);
  }
}

export function setLicensePayload(payload: LicensePayload): void {
  setSetting(LICENSE_PAYLOAD_KEY, JSON.stringify(payload));
}

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
    deleteSetting(LICENSE_PLAN_KEY);
  }
}

const SKILLS_INITIALIZED_AT_KEY = "skills_initialized_at";

export function getSkillsInitializedAt(): string | null {
  return getSetting(SKILLS_INITIALIZED_AT_KEY);
}

export function setSkillsInitializedAt(iso: string): void {
  setSetting(SKILLS_INITIALIZED_AT_KEY, iso);
}
