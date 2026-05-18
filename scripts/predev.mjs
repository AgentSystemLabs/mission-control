import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const env = { ...process.env };

env.POSTGRES_PORT ||= inferPostgresPortFromDotenv() || "55432";

console.log(`[predev] starting local Postgres on localhost:${env.POSTGRES_PORT}`);
run("docker", ["compose", "up", "-d", "--wait", "postgres"]);
run("docker", ["compose", "run", "--rm", "postgres-migrate"]);

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    env,
    stdio: "inherit",
  });

  if (result.error) {
    console.error(`[predev] failed to run ${command}:`, result.error);
    process.exit(1);
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function inferPostgresPortFromDotenv() {
  const dotenvPath = resolve(root, ".env");
  if (!existsSync(dotenvPath)) return null;

  const values = parseDotenv(readFileSync(dotenvPath, "utf8"));
  if (values.POSTGRES_PORT) return values.POSTGRES_PORT;
  if (!values.DATABASE_URL) return null;

  try {
    const url = new URL(values.DATABASE_URL);
    if (url.hostname === "localhost" || url.hostname === "127.0.0.1") {
      return url.port || "5432";
    }
  } catch {
    return null;
  }

  return null;
}

function parseDotenv(contents) {
  const values = {};

  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) continue;

    const key = trimmed.slice(0, separatorIndex).trim();
    values[key] = unquote(trimmed.slice(separatorIndex + 1).trim());
  }

  return values;
}

function unquote(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}
