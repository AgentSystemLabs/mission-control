import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import {
  betterSqliteRoot,
  prebuildInstallBin,
  canLoadNodeBetterSqlite,
} from "./lib/better-sqlite.mjs";

const requireFromHere = createRequire(import.meta.url);
const packageJson = requireFromHere("../package.json");
const packageManagerSpec = packageJson.packageManager ?? "pnpm";
const packageManagerCommand = process.platform === "win32" ? "corepack.cmd" : "corepack";

if (canLoadNodeBetterSqlite()) {
  process.exit(0);
}

console.log(`[native] missing Node better-sqlite3 binding for ABI ${process.versions.modules}; installing prebuilt binary`);
const prebuildResult = spawnSync(
  process.execPath,
  [
    prebuildInstallBin,
    "-r",
    "node",
    "-t",
    process.versions.node,
    "--platform",
    process.platform,
    "--arch",
    process.arch,
  ],
  {
    cwd: betterSqliteRoot,
    stdio: "inherit",
    env: process.env,
  },
);

if (prebuildResult.error) {
  console.error(prebuildResult.error);
}

if (prebuildResult.status === 0 && canLoadNodeBetterSqlite()) {
  process.exit(0);
}

console.log(`[native] no usable Node better-sqlite3 prebuild for ABI ${process.versions.modules}; rebuilding from source`);
const result = spawnSync(packageManagerCommand, [packageManagerSpec, "native:node:rebuild"], {
  stdio: "inherit",
  env: process.env,
  shell: process.platform === "win32",
});

if (result.error) {
  console.error(result.error);
  process.exit(1);
}

process.exit(result.status ?? 1);
