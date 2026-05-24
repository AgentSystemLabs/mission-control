import http from "node:http";
import net from "node:net";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const MAX_TCP_PORT = 65535;
const DEFAULT_DEV_PORT = 5173;
const HTTP_READY_TIMEOUT_MS = 30_000;
const HTTP_POLL_INTERVAL_MS = 200;
const STALE_SERVER_GRACE_MS = 1_500;

const mode = process.argv[2] ?? "electron";
const shouldStartPostgres = process.argv.includes("--postgres");
const env = { ...process.env };
env.MC_DEV_HOST ||= "127.0.0.1";
env.MC_DEV_PORT = String(parsePort(env.MC_DEV_PORT, DEFAULT_DEV_PORT));

if (mode !== "electron" && mode !== "web") {
  console.error(`[dev] unknown mode "${mode}". Expected "electron" or "web".`);
  process.exit(1);
}

if (mode === "electron") {
  // Electron dev uses the embedded SQLite store. Keep any shell-exported
  // hosted DATABASE_URL from turning on Postgres-backed web services.
  env.DATABASE_URL = "";
}

const port = await chooseDevPort(Number(env.MC_DEV_PORT), env.MC_DEV_HOST);
const origin = `http://${env.MC_DEV_HOST}:${port}`;
env.MC_DEV_PORT = String(port);
env.MC_DEV_URL ||= origin;
env.MC_SERVER_ORIGIN ||= origin;

console.log(`[dev] using Mission Control dev server on ${origin}`);

if (shouldStartPostgres) {
  env.POSTGRES_PORT ||= inferPostgresPortFromDotenv() || "55432";
  console.log(`[dev] starting local Postgres on localhost:${env.POSTGRES_PORT}`);
  run("docker", ["compose", "up", "-d", "--wait", "postgres"]);
  run("docker", ["compose", "run", "--rm", "postgres-migrate"]);
}

if (mode === "web") {
  run("corepack", ["pnpm@11.1.2", "dev:server"]);
} else {
  await runElectronDev(origin);
}

function parsePort(value, fallback) {
  const port = Number(value);
  return Number.isInteger(port) && port > 0 && port <= MAX_TCP_PORT ? port : fallback;
}

async function chooseDevPort(startPort, host) {
  for (let port = startPort; port <= MAX_TCP_PORT; port += 1) {
    cleanupStaleDevServer(port);
    if (await isPortAvailable(port, host)) return port;
  }
  throw new Error(`No available TCP port at or above ${startPort}`);
}

function isPortAvailable(port, host) {
  return new Promise((resolveAvailable) => {
    const server = net.createServer();
    server.unref();
    server.once("error", () => resolveAvailable(false));
    server.listen(port, host, () => {
      server.close(() => resolveAvailable(true));
    });
  });
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    env,
    stdio: "inherit",
    shell: process.platform === "win32",
  });

  if (result.error) {
    console.error(`[dev] failed to run ${command}:`, result.error);
    process.exit(1);
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

async function runElectronDev(origin) {
  const vite = spawnChild("vite", "corepack", ["pnpm@11.1.2", "dev:server"]);
  let electron = null;
  let stopping = false;

  const stopAll = () => {
    stopping = true;
    for (const child of [vite, electron]) {
      if (child && !child.killed) child.kill();
    }
  };

  const exitFromChild = (name, code, signal) => {
    if (stopping) return;
    console.error(`[dev] ${name} exited${signal ? ` with signal ${signal}` : ` with code ${code}`}`);
    stopAll();
    process.exit(code ?? 1);
  };

  vite.on("exit", (code, signal) => exitFromChild("vite", code, signal));

  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.once(signal, () => {
      stopAll();
      process.kill(process.pid, signal);
    });
  }

  try {
    await waitForHttp(origin);
  } catch (err) {
    console.error(`[dev] timed out waiting for ${origin}:`, err);
    stopAll();
    process.exit(1);
  }

  electron = spawnChild("electron", "corepack", ["pnpm@11.1.2", "dev:electron:main"]);
  electron.on("exit", (code, signal) => exitFromChild("electron", code, signal));
}

function spawnChild(name, command, args) {
  const child = spawn(command, args, {
    cwd: root,
    env,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  child.on("error", (err) => {
    console.error(`[dev] failed to start ${name}:`, err);
    process.exit(1);
  });
  return child;
}

function waitForHttp(url) {
  const deadline = Date.now() + HTTP_READY_TIMEOUT_MS;
  return new Promise((resolveReady, rejectReady) => {
    const tick = () => {
      const req = http.get(url, (res) => {
        res.resume();
        if (res.statusCode && res.statusCode < 500) {
          resolveReady();
          return;
        }
        if (Date.now() > deadline) {
          rejectReady(new Error(`Timed out waiting for ${url}`));
          return;
        }
        setTimeout(tick, HTTP_POLL_INTERVAL_MS);
      });
      req.on("error", () => {
        if (Date.now() > deadline) {
          rejectReady(new Error(`Timed out waiting for ${url}`));
          return;
        }
        setTimeout(tick, HTTP_POLL_INTERVAL_MS);
      });
    };
    tick();
  });
}

function cleanupStaleDevServer(port) {
  if (!Number.isInteger(port) || port <= 0 || port > MAX_TCP_PORT) return;

  const stalePids = pidsListeningOnPort(port).filter(isRepoViteProcess);
  if (stalePids.length === 0) return;

  console.log(
    `[dev] stopping stale Mission Control dev server on ${env.MC_DEV_HOST}:${port} ` +
      `(pid${stalePids.length === 1 ? "" : "s"} ${stalePids.join(", ")})`,
  );

  for (const pid of stalePids) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      /* already gone */
    }
  }

  const deadline = Date.now() + STALE_SERVER_GRACE_MS;
  while (Date.now() < deadline && pidsListeningOnPort(port).some((pid) => stalePids.includes(pid))) {
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
