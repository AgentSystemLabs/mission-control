import { eq, sql } from "drizzle-orm";
import { getDb } from "~/db/client";
import { appSettings } from "~/db/schema";

// Hot path (getBooleanSetting fires on many reads). Hoist the prepared statement
// once so drizzle/better-sqlite3 skips re-parsing/re-planning per call. Built
// lazily on first use since getDb() must open the connection first.
function buildGetAppSettingStmt() {
  return getDb()
    .select()
    .from(appSettings)
    .where(eq(appSettings.key, sql.placeholder("key")))
    .prepare();
}
let getAppSettingStmt: ReturnType<typeof buildGetAppSettingStmt> | null = null;

export function getAppSetting(key: string): string | null {
  if (!getAppSettingStmt) getAppSettingStmt = buildGetAppSettingStmt();
  return getAppSettingStmt.get({ key })?.value ?? null;
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
