import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { __resetEnvCacheForTests, serverEnv } from "~/shared/env";
import { getRepositories, resetRepositoriesForTests } from "..";
import { isUniqueConstraintError as isPostgresUniqueConstraintError } from "../postgres";
import { isUniqueConstraintError as isSqliteUniqueConstraintError } from "../sqlite";

const envKeys = [
  "MC_CLOUD_MODE",
  "DATABASE_URL",
  "BETTER_AUTH_SECRET",
  "BETTER_AUTH_URL",
  "BETTER_AUTH_TRUSTED_ORIGINS",
] as const;

const savedEnv = new Map<string, string | undefined>();

describe("repository provider", () => {
  beforeEach(() => {
    for (const key of envKeys) {
      savedEnv.set(key, process.env[key]);
      delete process.env[key];
    }
    process.env.MC_USER_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "mc-repo-provider-"));
    __resetEnvCacheForTests();
    resetRepositoriesForTests();
  });

  afterEach(() => {
    for (const key of envKeys) {
      const value = savedEnv.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    savedEnv.clear();
    __resetEnvCacheForTests();
    resetRepositoriesForTests();
  });

  it("uses SQLite repositories by default", () => {
    expect(getRepositories().mode).toBe("sqlite");
  });

  it("uses Postgres repositories in cloud mode without creating the SQLite file", () => {
    const userDataDir = process.env.MC_USER_DATA_DIR!;
    process.env.MC_CLOUD_MODE = "1";
    process.env.DATABASE_URL = "postgres://user:pass@localhost:5432/mission_control";
    process.env.BETTER_AUTH_SECRET = "test-secret-test-secret-test-secret";
    process.env.BETTER_AUTH_URL = "http://localhost:5173";
    __resetEnvCacheForTests();
    resetRepositoriesForTests();

    expect(getRepositories().mode).toBe("postgres");
    expect(fs.existsSync(path.join(userDataDir, "missioncontrol.db"))).toBe(false);
  });

  it("fails fast when cloud mode is missing Postgres/auth env", () => {
    process.env.MC_CLOUD_MODE = "1";
    __resetEnvCacheForTests();
    resetRepositoriesForTests();

    expect(() => serverEnv()).toThrow(/DATABASE_URL/);
    expect(() => getRepositories()).toThrow(/DATABASE_URL/);
  });

  it("recognizes wrapped unique-constraint errors from database drivers", () => {
    const wrappedPostgresError = new Error("Failed query: insert into projects ...");
    (wrappedPostgresError as Error & { cause: unknown }).cause = {
      code: "23505",
      message: "duplicate key value violates unique constraint",
    };

    const wrappedSqliteError = new Error("Failed query: insert into projects ...");
    (wrappedSqliteError as Error & { cause: unknown }).cause = {
      code: "SQLITE_CONSTRAINT_UNIQUE",
      message: "UNIQUE constraint failed: projects.path",
    };

    expect(isPostgresUniqueConstraintError(wrappedPostgresError)).toBe(true);
    expect(isSqliteUniqueConstraintError(wrappedSqliteError)).toBe(true);
  });
});
