import {
  deleteAppSetting,
  getAppSetting,
  setAppSetting,
} from "../repositories/app-settings.repo";
import { readJsonSetting } from "./settings";
import {
  type LicensePayload,
  type LicenseStatus,
} from "~/shared/license";

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
  const raw = getAppSetting(LICENSE_STATUS_KEY);
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

export function getLicenseState(): StoredLicenseState {
  return {
    key: getAppSetting(LICENSE_KEY_KEY),
    status: readLicenseStatus(),
    plan: getAppSetting(LICENSE_PLAN_KEY),
    lastValidatedAt: getAppSetting(LICENSE_LAST_VALIDATED_AT_KEY),
    payload: readJsonSetting<LicensePayload>(LICENSE_PAYLOAD_KEY),
  };
}

export function setLicenseKey(key: string): void {
  setAppSetting(LICENSE_KEY_KEY, key);
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
    deleteAppSetting(key);
  }
}

export function setLicensePayload(payload: LicensePayload): void {
  setAppSetting(LICENSE_PAYLOAD_KEY, JSON.stringify(payload));
}

export function setLicenseValidationResult(
  status: LicenseStatus,
  plan: string | null,
  now: Date = new Date(),
): void {
  setAppSetting(LICENSE_STATUS_KEY, status);
  setAppSetting(LICENSE_LAST_VALIDATED_AT_KEY, now.toISOString());
  if (plan) {
    setAppSetting(LICENSE_PLAN_KEY, plan);
  } else {
    deleteAppSetting(LICENSE_PLAN_KEY);
  }
}
