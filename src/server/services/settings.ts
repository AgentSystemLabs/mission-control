import { randomBytes } from "node:crypto";
import {
  deleteAppSetting,
  getAppSetting,
  setAppSetting,
} from "../repositories/app-settings.repo";

export function getSetting(key: string): string | null {
  return getAppSetting(key);
}

export function setSetting(key: string, value: string): void {
  setAppSetting(key, value);
}

export function deleteSetting(key: string): void {
  deleteAppSetting(key);
}

export function getBooleanSetting(key: string, defaultValue = false): boolean {
  const value = getAppSetting(key);
  if (value === null) return defaultValue;
  return value === "true";
}

export function setBooleanSetting(key: string, value: boolean): void {
  setAppSetting(key, value ? "true" : "false");
}

export function readJsonSetting<T>(key: string): T | null {
  const raw = getAppSetting(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

const API_TOKEN_KEY = "api_token";
const AUTH_SECRET_KEY = "auth_secret";

export function getOrCreateApiToken(): string {
  let token = getAppSetting(API_TOKEN_KEY);
  if (!token) {
    token = randomBytes(32).toString("hex");
    setAppSetting(API_TOKEN_KEY, token);
  }
  return token;
}

export function getOrCreateAuthSecret(): string {
  let secret = getAppSetting(AUTH_SECRET_KEY);
  if (!secret) {
    secret = randomBytes(32).toString("hex");
    setAppSetting(AUTH_SECRET_KEY, secret);
  }
  return secret;
}

const SKILLS_INITIALIZED_AT_KEY = "skills_initialized_at";

export function getSkillsInitializedAt(): string | null {
  return getAppSetting(SKILLS_INITIALIZED_AT_KEY);
}

export function setSkillsInitializedAt(iso: string): void {
  setAppSetting(SKILLS_INITIALIZED_AT_KEY, iso);
}
