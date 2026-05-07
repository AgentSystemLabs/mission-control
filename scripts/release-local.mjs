#!/usr/bin/env node
// Local release script — mirrors what .github/workflows/release.yml does, but
// for the platforms you can actually build on your laptop.
//
// Usage:
//   MISSION_CONTROL_RELEASE_TOKEN=... ACADEMY_BASE_URL=https://agentsystem.dev \
//     node scripts/release-local.mjs [--version v0.2.0] [--platforms mac-arm64,mac-x64] \
//                                    [--notes "..."] [--notes-file path] [--skip-build]
//
// Defaults:
//   --version    "v" + version from package.json
//   --platforms  whatever your host can build (mac → mac-arm64 + mac-x64,
//                windows → win-x64, linux → linux-x64)
//   --notes      empty
//
// Env (read at runtime, not at parse time, so .env-loader wrappers work):
//   MISSION_CONTROL_RELEASE_TOKEN  required — bearer token for academy
//   ACADEMY_BASE_URL               required — e.g. https://agentsystem.dev
//
// You can also drop a `.env.release` file in the repo root with KEY=VAL lines;
// it'll be loaded if present.

import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  createReadStream,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { platform as osPlatform } from "node:os";

const REPO_ROOT = resolve(new URL("..", import.meta.url).pathname);
process.chdir(REPO_ROOT);

function fail(msg) {
  console.error(`[release-local] ${msg}`);
  process.exit(1);
}

// ---------- tiny .env loader (no external dep) ----------
function loadDotEnv(file) {
  if (!existsSync(file)) return;
  const text = readFileSync(file, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/i.exec(line);
    if (!m) continue;
    if (process.env[m[1]] !== undefined) continue;
    let val = m[2];
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    process.env[m[1]] = val;
  }
}
loadDotEnv(join(REPO_ROOT, ".env.release"));

// ---------- arg parsing ----------
const args = process.argv.slice(2);
function getArg(name, { boolean = false } = {}) {
  const flag = `--${name}`;
  const inline = args.find((arg) => arg.startsWith(`${flag}=`));
  if (inline) {
    const value = inline.slice(flag.length + 1);
    return boolean ? value !== "false" : value;
  }

  const idx = args.indexOf(flag);
  if (idx === -1) return undefined;
  if (boolean) return true;
  const value = args[idx + 1];
  if (!value || value.startsWith("--")) fail(`${flag} requires a value`);
  return value;
}

const PLATFORMS_ALL = ["mac-arm64", "mac-x64", "win-x64", "linux-x64"];
const PLATFORM_BY_HOST = {
  darwin: ["mac-arm64", "mac-x64"],
  win32: ["win-x64"],
  linux: ["linux-x64"],
};

const PLATFORM_BUILDER = {
  "mac-arm64": { flags: ["--mac", "--arm64"], ext: "dmg", contentType: "application/x-apple-diskimage" },
  "mac-x64": { flags: ["--mac", "--x64"], ext: "dmg", contentType: "application/x-apple-diskimage" },
  "win-x64": { flags: ["--win", "--x64"], ext: "exe", contentType: "application/vnd.microsoft.portable-executable" },
  "linux-x64": { flags: ["--linux", "--x64"], ext: "AppImage", contentType: "application/x-executable" },
};

const pkg = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8"));
const version = getArg("version") ?? `v${pkg.version}`;
if (!/^v?[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$/.test(version)) {
  fail(`invalid --version: ${version}`);
}

const platformsArg = getArg("platforms");
const platforms = platformsArg
  ? platformsArg.split(",").map((p) => p.trim()).filter(Boolean)
  : PLATFORM_BY_HOST[osPlatform()] ?? [];
for (const p of platforms) {
  if (!PLATFORMS_ALL.includes(p)) fail(`unknown platform: ${p}`);
}
if (platforms.length === 0) fail("no platforms to build");

const notesFile = getArg("notes-file");
const notesArg = getArg("notes");
let notes = null;
if (notesFile) notes = readFileSync(notesFile, "utf8");
else if (notesArg) notes = notesArg;
if (notes !== null) notes = notes.trim() || null;

const skipBuild = Boolean(getArg("skip-build", { boolean: true }));

const { MISSION_CONTROL_RELEASE_TOKEN, ACADEMY_BASE_URL } = process.env;
if (!MISSION_CONTROL_RELEASE_TOKEN)
  fail("MISSION_CONTROL_RELEASE_TOKEN env var is required");
if (!ACADEMY_BASE_URL) fail("ACADEMY_BASE_URL env var is required");

// ---------- build ----------
function run(cmd, argv, opts = {}) {
  console.log(`[release-local] $ ${cmd} ${argv.join(" ")}`);
  const res = spawnSync(cmd, argv, { stdio: "inherit", shell: false, ...opts });
  if (res.status !== 0) fail(`command failed: ${cmd} ${argv.join(" ")}`);
}

async function sha256File(filePath) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) {
    hash.update(chunk);
  }
  return hash.digest("hex");
}

const OUT_DIR = join(REPO_ROOT, "dist-electron-out");
const ARTIFACTS_DIR = join(REPO_ROOT, "artifacts");

if (!skipBuild) {
  // Common build steps once.
  run("pnpm", ["build"]);
  run("pnpm", ["native:electron"]);
}

// Build each platform separately so artifacts are isolated per-platform.
for (const platform of platforms) {
  const cfg = PLATFORM_BUILDER[platform];
  if (!skipBuild) {
    // Clear previous output for this run.
    rmSync(OUT_DIR, { recursive: true, force: true });
    run("pnpm", [
      "exec",
      "electron-builder",
      ...cfg.flags,
      "--publish",
      "never",
      `-c.directories.output=${OUT_DIR}`,
    ]);
  }
  // Find the produced installer.
  const matches = readdirSync(OUT_DIR).filter(
    (f) => f.endsWith(`.${cfg.ext}`) && !f.endsWith(`.${cfg.ext}.blockmap`)
  );
  if (matches.length === 0) {
    fail(
      `no .${cfg.ext} found in ${OUT_DIR} for ${platform} (try without --skip-build)`
    );
  }
  const fileName = matches[0];
  const filePath = join(OUT_DIR, fileName);
  const sizeBytes = statSync(filePath).size;
  const sha256 = await sha256File(filePath);

  // Copy to artifacts/mc-<platform>/.
  const dest = join(ARTIFACTS_DIR, `mc-${platform}`);
  mkdirSync(dest, { recursive: true });
  const destFile = join(dest, fileName);
  copyFileSync(filePath, destFile);
  writeFileSync(
    join(dest, "manifest.json"),
    JSON.stringify(
      {
        platform,
        fileName,
        sizeBytes,
        sha256,
        contentType: cfg.contentType,
      },
      null,
      2
    )
  );
  console.log(
    `[release-local] ✓ ${platform}: ${fileName} (${sizeBytes} bytes, sha256=${sha256.slice(0, 12)}…)`
  );
}

// ---------- publish ----------
process.env.RELEASE_VERSION = version;
process.env.RELEASE_NOTES = notes ?? "";
console.log(
  `[release-local] publishing ${version} to ${ACADEMY_BASE_URL} (${platforms.length} platform(s))`
);
const pub = spawnSync(
  process.execPath,
  [join(REPO_ROOT, "scripts", "publish-release.mjs")],
  { stdio: "inherit", env: process.env }
);
if (pub.status !== 0) fail("publish step failed");
console.log("[release-local] ✓ done");
