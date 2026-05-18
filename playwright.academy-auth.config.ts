import { defineConfig, devices } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function readAcademyEnvValue(name: string): string | null {
  try {
    const envFile = readFileSync(resolve(process.cwd(), "../academy/.env"), "utf8");
    const line = envFile
      .split(/\r?\n/)
      .find((entry) => entry.startsWith(`${name}=`));
    return line ? line.slice(name.length + 1).trim() : null;
  } catch {
    return null;
  }
}

const missionControlPort = Number(process.env.MC_E2E_PORT ?? 4181);
const academyPort = Number(process.env.ACADEMY_E2E_PORT ?? 3001);
const missionControlOrigin = `http://127.0.0.1:${missionControlPort}`;
const academyOrigin = `http://127.0.0.1:${academyPort}`;
const academyPostgresPort =
  process.env.ACADEMY_E2E_POSTGRES_PORT ??
  readAcademyEnvValue("POSTGRES_PORT") ??
  "5432";
const academyDbUrl =
  process.env.ACADEMY_E2E_DATABASE_URL ??
  `postgresql://postgres:example@localhost:${academyPostgresPort}/agentsystem_test`;
const missionControlDbUrl =
  process.env.MC_E2E_DATABASE_URL ??
  "postgres://mission_control:mission_control_dev@localhost:55432/mission_control";
const entitlementSecret =
  process.env.MC_E2E_ENTITLEMENTS_SECRET ?? "test-mission-control-entitlements-secret";
const createAcademyTestDbCommand = `node -e "const pg=require('pg'); const client=new pg.Client({connectionString:'postgresql://postgres:example@localhost:${academyPostgresPort}/postgres'}); (async()=>{await client.connect(); const result=await client.query(\\"SELECT 1 FROM pg_database WHERE datname = 'agentsystem_test'\\"); if(result.rowCount===0) await client.query('CREATE DATABASE agentsystem_test'); await client.end();})().catch((error)=>{console.error(error); process.exit(1);});"`;

export default defineConfig({
  testDir: "./e2e",
  testMatch: /academy-auth-flow\.spec\.ts/,
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  workers: 1,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: missionControlOrigin,
    trace: "on-first-retry",
  },
  webServer: [
    {
      command: [
        "npm run db:up",
        createAcademyTestDbCommand,
        [
          `DATABASE_URL_TEST=${academyDbUrl}`,
          `HOST_NAME=${academyOrigin}`,
          "NODE_ENV=test",
          "IS_TEST=true",
          `MISSION_CONTROL_ENTITLEMENTS_API_SECRET=${entitlementSecret}`,
          "./node_modules/.bin/tsx ./src/db/migrate.ts",
        ].join(" "),
        [
          `DATABASE_URL_TEST=${academyDbUrl}`,
          `HOST_NAME=${academyOrigin}`,
          "NODE_ENV=test",
          "IS_TEST=true",
          `MISSION_CONTROL_ENTITLEMENTS_API_SECRET=${entitlementSecret}`,
          `./node_modules/.bin/vite dev --host 127.0.0.1 --port ${academyPort} --strictPort`,
        ].join(" "),
      ].join(" && "),
      cwd: "../academy",
      url: academyOrigin,
      timeout: 180_000,
      reuseExistingServer: false,
    },
    {
      command: [
        "POSTGRES_PORT=55432 docker compose up -d postgres",
        "POSTGRES_PORT=55432 docker compose run --rm postgres-migrate",
        [
          `DATABASE_URL=${missionControlDbUrl}`,
          "MC_SESSION_SECRET=test-mission-control-session-secret",
          "MC_SUPPORT_API_TOKEN=test-support-token",
          `ACADEMY_PUBLIC_URL=${academyOrigin}`,
          `ACADEMY_ENTITLEMENTS_API_URL=${academyOrigin}/api/mission-control/entitlements/exchange`,
          `ACADEMY_ENTITLEMENTS_API_SECRET=${entitlementSecret}`,
          "ACADEMY_MISSION_CONTROL_AUTHORIZE_PATH=/api/mission-control/authorize",
          `MC_DEV_PORT=${missionControlPort}`,
          "MC_DEV_HOST=127.0.0.1",
          "pnpm dev:server",
        ].join(" "),
      ].join(" && "),
      url: `${missionControlOrigin}/api/healthz`,
      timeout: 180_000,
      reuseExistingServer: false,
    },
  ],
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
