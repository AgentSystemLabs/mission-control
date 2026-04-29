import { eq } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { getDb } from "./client";
import { appSettings } from "./schema";

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
