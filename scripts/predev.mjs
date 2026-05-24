import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const env = { ...process.env };
const shouldStartPostgres = process.argv.includes("--postgres");

env.MC_DEV_HOST ||= "127.0.0.1";
env.MC_DEV_PORT ||= "5173";
env.POSTGRES_PORT ||= inferPostgresPortFromDotenv() || "55432";

cleanupStaleDevServer(Number(env.MC_DEV_PORT));
assertDevPortAvailable(Number(env.MC_DEV_PORT));

if (shouldStartPostgres) {
  console.log(`[predev] starting local Postgres on localhost:${env.POSTGRES_PORT}`);
  run("docker", ["compose", "up", "-d", "--wait", "postgres"]);
  run("docker", ["compose", "run", "--rm", "postgres-migrate"]);
}

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

function cleanupStaleDevServer(port) {
  if (!Number.isInteger(port) || port <= 0 || port > 65535) return;

  const stalePids = pidsListeningOnPort(port).filter(isRepoViteProcess);
  if (stalePids.length === 0) return;

  console.log(
    `[predev] stopping stale Mission Control dev server on ${env.MC_DEV_HOST}:${port} ` +
      `(pid${stalePids.length === 1 ? "" : "s"} ${stalePids.join(", ")})`
  );

  for (const pid of stalePids) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      /* already gone */
    }
  }

  const deadline = Date.now() + 1500;
  while (
    Date.now() < deadline &&
    pidsListeningOnPort(port).some((pid) => stalePids.includes(pid))
  ) {
    sleepSync(100);
  }

  for (const pid of pidsListeningOnPort(port).filter((pid) => stalePids.includes(pid))) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      /* already gone */
    }
  }
}

function assertDevPortAvailable(port) {
  if (!Number.isInteger(port) || port <= 0 || port > 65535) return;

  const remainingPids = pidsListeningOnPort(port);
  if (remainingPids.length === 0) return;

  console.error(`[predev] ${env.MC_DEV_HOST}:${port} is already in use.`);
  for (const pid of remainingPids) {
    const command = processCommand(pid);
    console.error(`[predev]   pid ${pid}${command ? `: ${command}` : ""}`);
  }
  console.error(
    "[predev] Quit the process using that port, then run the dev command again."
  );
  process.exit(1);
}

function pidsListeningOnPort(port) {
  if (process.platform === "win32") {
    const result = spawnSync("netstat", ["-ano", "-p", "tcp"], {
      encoding: "utf8",
    });
    if (result.error || result.status !== 0) return [];

    return (result.stdout || "")
      .split(/\r?\n/)
      .map((line) => line.trim().split(/\s+/))
      .filter((parts) => parts.length >= 5 && parts[0] === "TCP" && parts[3] === "LISTENING")
      .filter((parts) => parts[1]?.endsWith(`:${port}`))
      .map((parts) => Number(parts[4]))
      .filter((pid) => Number.isInteger(pid) && pid > 0 && pid !== process.pid);
  }

  const result = spawnSync("lsof", ["-nP", `-tiTCP:${port}`, "-sTCP:LISTEN"], {
    encoding: "utf8",
  });
  if (result.error || result.status !== 0) return [];

  return (result.stdout || "")
    .split(/\s+/)
    .map((raw) => Number(raw))
    .filter((pid) => Number.isInteger(pid) && pid > 0 && pid !== process.pid);
}

function isRepoViteProcess(pid) {
  if (process.platform === "win32") {
    const command = processCommand(pid);
    return command.includes(root) && /\bvite(\.js)?\b/.test(command) && command.includes("--strictPort");
  }

  const cwd = processCwd(pid);
  if (!cwd || resolve(cwd) !== root) return false;

  const command = processCommand(pid);
  return /\bvite(\.js)?\b/.test(command) && command.includes("--strictPort");
}

function processCommand(pid) {
  if (process.platform === "win32") {
    const result = spawnSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-Command",
        `$p = Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}"; if ($p) { $p.CommandLine }`,
      ],
      { encoding: "utf8" },
    );
    return result.status === 0 ? result.stdout.trim() : "";
  }

  const result = spawnSync("ps", ["-p", String(pid), "-o", "command="], {
    encoding: "utf8",
  });
  return result.status === 0 ? result.stdout.trim() : "";
}

function processCwd(pid) {
  const result = spawnSync("lsof", ["-a", "-p", String(pid), "-d", "cwd", "-Fn"], {
    encoding: "utf8",
  });
  if (result.error || result.status !== 0) return null;
  const line = result.stdout.split(/\r?\n/).find((entry) => entry.startsWith("n"));
  return line ? line.slice(1) : null;
}

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
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
