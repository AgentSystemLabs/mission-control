import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import {
  betterSqliteRoot,
  prebuildInstallBin,
  canLoadNodeBetterSqlite,
} from "./lib/better-sqlite.mjs";

const requireFromHere = createRequire(import.meta.url);
const packageJson = requireFromHere("../package.json");
const packageManagerSpec = packageJson.packageManager ?? "pnpm";
const packageManagerCommand = process.platform === "win32" ? "corepack.cmd" : "corepack";
const electronPath = requireFromHere("electron");
const abiResult = spawnSync(
  electronPath,
  [
    "-e",
    "process.stdout.write(JSON.stringify({ platform: process.platform, arch: process.arch, abi: process.versions.modules }))",
  ],
  {
    encoding: "utf8",
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
  },
);

if (abiResult.error || abiResult.status !== 0) {
  if (abiResult.stderr) process.stderr.write(abiResult.stderr);
  if (abiResult.error) console.error(abiResult.error);
  process.exit(abiResult.status ?? 1);
}

const electronRuntime = JSON.parse(abiResult.stdout);
const electronAbi = electronRuntime.abi;
const electronVersion = requireFromHere("electron/package.json").version;
const electronBindingPath = path.join(
  betterSqliteRoot,
  "bin",
  `${electronRuntime.platform}-${electronRuntime.arch}-${electronAbi}`,
  "better-sqlite3.node",
);
const defaultBindingPath = path.join(
  betterSqliteRoot,
  "build",
  "Release",
  "better_sqlite3.node",
);

function canLoadElectronBetterSqlite() {
  if (!fs.existsSync(electronBindingPath)) return false;
  const result = spawnSync(
    electronPath,
    [
      "-e",
      "const Database = require(process.argv[1]); const db = new Database(':memory:', { nativeBinding: process.argv[2] }); db.prepare('select 1').get(); db.close();",
      betterSqliteRoot,
      electronBindingPath,
    ],
    {
      cwd: betterSqliteRoot,
      encoding: "utf8",
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
    },
  );

  return result.status === 0;
}

function runPrebuildInstall(runtime, target, platform, arch) {
  return spawnSync(
    process.execPath,
    [
      prebuildInstallBin,
      "-r",
      runtime,
      "-t",
      target,
      "--platform",
      platform,
      "--arch",
      arch,
    ],
    {
      cwd: betterSqliteRoot,
      stdio: "inherit",
      env: process.env,
    },
  );
}

function copyDefaultBindingToElectronBinding() {
  if (!fs.existsSync(defaultBindingPath)) return false;
  fs.mkdirSync(path.dirname(electronBindingPath), { recursive: true });
  fs.copyFileSync(defaultBindingPath, electronBindingPath);
  return true;
}

function restoreNodeBinding() {
  if (canLoadNodeBetterSqlite()) return true;

  console.log(`[native] restoring Node better-sqlite3 binding for ABI ${process.versions.modules}`);
  const result = runPrebuildInstall("node", process.versions.node, process.platform, process.arch);
  if (result.error) console.error(result.error);
  if (result.status === 0 && canLoadNodeBetterSqlite()) return true;

  console.log(
    `[native] no usable Node better-sqlite3 prebuild for ABI ${process.versions.modules}; rebuilding from source`,
  );
  const rebuildResult = spawnSync(packageManagerCommand, [packageManagerSpec, "native:node:rebuild"], {
    stdio: "inherit",
    env: process.env,
    shell: process.platform === "win32",
  });

  if (rebuildResult.error) console.error(rebuildResult.error);
  return rebuildResult.status === 0 && canLoadNodeBetterSqlite();
}

if (canLoadElectronBetterSqlite()) {
  process.exit(restoreNodeBinding() ? 0 : 1);
}

console.log(
  `[native] missing Electron better-sqlite3 binding for ABI ${electronAbi}; installing prebuilt binary`,
);
const prebuildResult = runPrebuildInstall(
  "electron",
  electronVersion,
  electronRuntime.platform,
  electronRuntime.arch,
);

if (prebuildResult.error) {
  console.error(prebuildResult.error);
}

if (
  prebuildResult.status === 0 &&
  copyDefaultBindingToElectronBinding() &&
  canLoadElectronBetterSqlite()
) {
  process.exit(restoreNodeBinding() ? 0 : 1);
}

console.log(
  `[native] no usable Electron better-sqlite3 prebuild for ABI ${electronAbi}; rebuilding from source`,
);
const result = spawnSync(packageManagerCommand, [packageManagerSpec, "native:electron:sqlite:source"], {
  stdio: "inherit",
  env: {
    ...process.env,
    npm_config_arch: electronRuntime.arch,
    npm_config_platform: electronRuntime.platform,
  },
  shell: process.platform === "win32",
});

if (result.error) {
  console.error(result.error);
  process.exit(1);
}
if (result.status !== 0) process.exit(result.status ?? 1);

if (!canLoadElectronBetterSqlite() && copyDefaultBindingToElectronBinding()) {
  canLoadElectronBetterSqlite();
}

process.exit(canLoadElectronBetterSqlite() && restoreNodeBinding() ? 0 : 1);
