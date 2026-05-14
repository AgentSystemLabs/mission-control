import { randomBytes } from "node:crypto";
import { getRepositories, type UserScope } from "../repositories";

export async function getSetting(key: string, scope?: UserScope): Promise<string | null> {
  return getRepositories().settings.get(key, scope);
}

export async function setSetting(key: string, value: string, scope?: UserScope): Promise<void> {
  await getRepositories().settings.set(key, value, scope);
}

export async function getBooleanSetting(
  key: string,
  defaultValue = false,
  scope?: UserScope,
): Promise<boolean> {
  const value = await getSetting(key, scope);
  if (value === null) return defaultValue;
  return value === "true";
}

export async function setBooleanSetting(
  key: string,
  value: boolean,
  scope?: UserScope,
): Promise<void> {
  await setSetting(key, value ? "true" : "false", scope);
}

export async function regenerateApiToken(scope?: UserScope): Promise<string> {
  const token = randomBytes(32).toString("hex");
  await setSetting("api_token", token, scope);
  return token;
}
