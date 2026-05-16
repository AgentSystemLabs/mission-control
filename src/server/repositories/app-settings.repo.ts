import { eq } from "drizzle-orm";
import { getDb } from "~/db/client";
import { appSettings } from "~/db/schema";

export function getAppSetting(key: string): string | null {
  const db = getDb();
  const row = db.select().from(appSettings).where(eq(appSettings.key, key)).get();
  return row?.value ?? null;
}

export function setAppSetting(key: string, value: string): void {
  const db = getDb();
  db.insert(appSettings)
    .values({ key, value })
    .onConflictDoUpdate({ target: appSettings.key, set: { value } })
    .run();
}

export function deleteAppSetting(key: string): void {
  const db = getDb();
  db.delete(appSettings).where(eq(appSettings.key, key)).run();
}
