#!/usr/bin/env node
// Re-sign a locally-built MissionControl.app so macOS Screen Recording
// (and other TCC permissions) actually persist across launches.
//
// Why this exists:
//   Without a Developer ID certificate in the keychain, electron-builder
//   falls back to ad-hoc signing. On some machines the resulting bundle
//   ends up with a BROKEN seal (identifier "Electron", `codesign --verify`
//   fails with "code has no resources but signature indicates they must be
//   present"). macOS TCC keys the Screen Recording grant to a *valid, stable*
//   code identity, so a broken signature means the grant never persists and
//   the OS re-prompts on every launch.
//
//   This script gives the installed bundle a valid ad-hoc + hardened-runtime
//   seal (correct identifier) and clears the stale Screen Recording grant so
//   the next grant sticks. It is a LOCAL-ONLY fix — it must be re-run after
//   every `pnpm dist:mac`, since each rebuild produces a new cdhash. For a
//   build you can ship to other Macs, sign with a Developer ID cert and
//   notarize instead (the electron-builder `mac` config is already wired for
//   it).
//
// Usage:
//   node scripts/resign-local-macos.mjs                 # /Applications/MissionControl.app
//   node scripts/resign-local-macos.mjs /path/to/App    # a specific bundle
//
// After running: fully quit MissionControl (Cmd+Q, not just close the window),
// relaunch, trigger a capture, and grant Screen Recording once.

import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const APP_ID = "labs.agentsystem.missioncontrol";
const appPath = path.resolve(process.argv[2] ?? "/Applications/MissionControl.app");
const entitlements = path.join(repoRoot, "build", "entitlements.mac.plist");

if (process.platform !== "darwin") {
  console.error("This script only applies to macOS.");
  process.exit(1);
}
if (!fs.existsSync(appPath)) {
  console.error(`App bundle not found: ${appPath}`);
  process.exit(1);
}
if (!fs.existsSync(entitlements)) {
  console.error(`Entitlements not found: ${entitlements}`);
  process.exit(1);
}

function run(cmd, args) {
  console.log(`$ ${cmd} ${args.join(" ")}`);
  return execFileSync(cmd, args, { stdio: "inherit" });
}

console.log(`\nRe-signing ${appPath}\n`);
run("codesign", [
  "--force",
  "--deep",
  "--options",
  "runtime",
  "--entitlements",
  entitlements,
  "--sign",
  "-",
  appPath,
]);

console.log("\nVerifying signature (silent output = valid)...");
run("codesign", ["--verify", "--deep", "--strict", appPath]);

console.log("\nResetting stale Screen Recording grant...");
run("tccutil", ["reset", "ScreenCapture", APP_ID]);

console.log(
  "\nDone. Now fully quit MissionControl (Cmd+Q), relaunch, trigger a capture,\n" +
    "and grant Screen Recording once — it will persist until the next rebuild.\n",
);
