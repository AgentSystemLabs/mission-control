import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const migrationDir = path.join(root, "src", "db", "pg-migrations");

function loadDotEnv(file) {
  try {
    const text = require("node:fs").readFileSync(file, "utf8");
    for (const raw of text.split("\n")) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq < 0) continue;
      const key = line.slice(0, eq).trim();
      if (!key || key in process.env) continue;
      let value = line.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      process.env[key] = value;
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

const { createRequire } = await import("node:module");
const require = createRequire(import.meta.url);
loadDotEnv(path.join(root, ".env"));

const env = {
  ...process.env,
  CLOUD: process.env.CLOUD ?? "1",
  MC_CLOUD_MODE: process.env.MC_CLOUD_MODE ?? "1",
  MC_DEV_HOST: process.env.MC_DEV_HOST ?? "127.0.0.1",
  MC_DEV_PORT: process.env.MC_DEV_PORT ?? "5173",
  DATABASE_URL:
    process.env.DATABASE_URL ??
    "postgres://mission_control:mission_control@127.0.0.1:5432/mission_control",
  BETTER_AUTH_SECRET:
    process.env.BETTER_AUTH_SECRET ??
    "local-dev-better-auth-secret-local-dev",
  BETTER_AUTH_URL:
    process.env.BETTER_AUTH_URL ??
    "http://127.0.0.1:5173",
};

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      env,
      stdio: "inherit",
      shell: false,
      ...options,
    });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(" ")} failed (${signal ?? code})`));
    });
  });
}

async function waitForPostgres() {
  const deadline = Date.now() + 60_000;
  let lastError;

  while (Date.now() < deadline) {
    const sql = postgres(env.DATABASE_URL, {
      max: 1,
      connect_timeout: 2,
      prepare: false,
    });
    try {
      await sql`SELECT 1`;
      await sql.end({ timeout: 1 });
      return;
    } catch (error) {
      lastError = error;
      await sql.end({ timeout: 1 }).catch(() => {});
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  throw new Error(`Postgres did not become ready in time: ${lastError?.message ?? "unknown error"}`);
}

async function runMigrations() {
  const sql = postgres(env.DATABASE_URL, {
    max: 1,
    prepare: false,
  });

  try {
    await sql`
      CREATE TABLE IF NOT EXISTS __mc_pg_migrations (
        name TEXT PRIMARY KEY,
        applied_at TIMESTAMP NOT NULL DEFAULT now()
      )
    `;

    const rows = await sql`SELECT name FROM __mc_pg_migrations`;
    const applied = new Set(rows.map((row) => row.name));
    const files = (await fs.readdir(migrationDir))
      .filter((file) => file.endsWith(".sql"))
      .sort();

    for (const file of files) {
      if (applied.has(file)) continue;
      const body = await fs.readFile(path.join(migrationDir, file), "utf8");
      process.stdout.write(`Applying Postgres migration ${file}\n`);
      await sql.begin(async (tx) => {
        await tx.unsafe(body);
        await tx`
          INSERT INTO __mc_pg_migrations (name)
          VALUES (${file})
        `;
      });
    }
  } finally {
    await sql.end({ timeout: 1 });
  }
}

function runDevServer() {
  const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
  const child = spawn(pnpm, ["dev:server"], {
    cwd: root,
    env,
    stdio: "inherit",
  });

  const forward = (signal) => {
    if (!child.killed) child.kill(signal);
  };
  process.on("SIGINT", forward);
  process.on("SIGTERM", forward);

  child.on("exit", (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    process.exit(code ?? 1);
  });
}

async function main() {
  process.stdout.write("Starting local Postgres 17 with Docker Compose...\n");
  await run("docker", ["compose", "up", "-d", "postgres"]);
  process.stdout.write("Waiting for Postgres to accept connections...\n");
  await waitForPostgres();
  process.stdout.write("Running Postgres migrations...\n");
  await runMigrations();
  process.stdout.write("Starting Mission Control in cloud mode...\n");
  runDevServer();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
