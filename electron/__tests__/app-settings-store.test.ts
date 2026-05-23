import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import {
  disposeAppSettingsStore,
  getBooleanAppSetting,
} from "../app-settings-store";

describe("app-settings-store", () => {
  let userDataDir: string;

  afterEach(() => {
    disposeAppSettingsStore();
    if (userDataDir) fs.rmSync(userDataDir, { recursive: true, force: true });
  });

  it("returns the default when a boolean setting is unset", () => {
    userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-app-settings-"));
    expect(
      getBooleanAppSetting(userDataDir, "automatic_update_downloads_enabled", false),
    ).toBe(false);
  });

  it("reads persisted boolean settings from missioncontrol.db", () => {
    userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-app-settings-"));
    fs.mkdirSync(userDataDir, { recursive: true });
    const dbPath = path.join(userDataDir, "missioncontrol.db");

    // Seed the same app_settings table the server writes through settings API.
    const db = new Database(dbPath);
    db.exec(
      `CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);`,
    );
    const upsert = db.prepare(
      "INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    );
    upsert.run("automatic_update_downloads_enabled", "true");
    upsert.run("automatic_update_install_on_quit_enabled", "true");
    db.close();

    expect(
      getBooleanAppSetting(userDataDir, "automatic_update_downloads_enabled", false),
    ).toBe(true);
    expect(
      getBooleanAppSetting(userDataDir, "automatic_update_install_on_quit_enabled", false),
    ).toBe(true);
  });
});
