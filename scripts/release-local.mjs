#!/usr/bin/env node
import { makeFail } from "./lib/cli.mjs";
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
  existsSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { platform as osPlatform } from "node:os";

const REPO_ROOT = resolve(new URL("..", import.meta.url).pathname);
process.chdir(REPO_ROOT);

const fail = makeFail("release-local");

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
  "mac-arm64": { flags: ["--mac", "--arm64"], ext: "dmg" },
  "mac-x64": { flags: ["--mac", "--x64"], ext: "dmg" },
  "win-x64": { flags: ["--win", "--x64"], ext: "exe" },
  "linux-x64": { flags: ["--linux", "--x64"], ext: "AppImage" },
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

const OUT_DIR = join(REPO_ROOT, "dist-electron-out");
const ARTIFACTS_DIR = join(REPO_ROOT, "artifacts");

rmSync(ARTIFACTS_DIR, { recursive: true, force: true });
process.env.RELEASE_VERSION = version;
process.env.RELEASE_NOTES = notes ?? "";
process.env.RELEASE_EXPECTED_PLATFORMS = platforms.join(",");

console.log(
  `[release-local] publishing ${version} to ${ACADEMY_BASE_URL} (${platforms.length} platform(s))`
);
run(process.execPath, [join(REPO_ROOT, "scripts", "publish-release.mjs"), "prepare"]);

if (!skipBuild) {
  // Common build steps once.
  run("pnpm", ["setup:whisper"]);
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
  const dest = join(ARTIFACTS_DIR, `mc-${platform}`);
  run(
    process.execPath,
    [join(REPO_ROOT, "scripts", "stage-release-artifacts.mjs")],
    {
      env: {
        ...process.env,
        RELEASE_PLATFORM: platform,
        RELEASE_ARTIFACT_EXT: cfg.ext,
        OUT_DIR,
        ARTIFACTS_DIR: dest,
      },
    }
  );
  run(
    process.execPath,
    [join(REPO_ROOT, "scripts", "publish-release.mjs"), "publish"],
    { env: { ...process.env, ARTIFACTS_DIR: dest } }
  );
}

// ---------- finalize ----------
if (platforms.some((platform) => platform.startsWith("mac-"))) {
  const macMetadataDir = join(ARTIFACTS_DIR, "mc-mac-metadata");
  run(process.execPath, [join(REPO_ROOT, "scripts", "compose-mac-update-manifest.mjs")], {
    env: {
      ...process.env,
      RELEASE_MANIFESTS_DIR: ARTIFACTS_DIR,
      ARTIFACTS_DIR: macMetadataDir,
    },
  });
  run(process.execPath, [join(REPO_ROOT, "scripts", "publish-release.mjs"), "publish"], {
    env: { ...process.env, ARTIFACTS_DIR: macMetadataDir },
  });
}
run(process.execPath, [join(REPO_ROOT, "scripts", "publish-release.mjs"), "finalize"]);
console.log("[release-local] ✓ done");
