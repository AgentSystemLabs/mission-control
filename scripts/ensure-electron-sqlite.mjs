import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

const requireFromHere = createRequire(import.meta.url);
const electronPath = requireFromHere("electron");
const abiResult = spawnSync(
  electronPath,
  ["-e", "process.stdout.write(process.versions.modules)"],
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

const electronAbi = abiResult.stdout.trim();
const betterSqlitePackageJson = requireFromHere.resolve("better-sqlite3/package.json");
const betterSqliteRoot = path.dirname(betterSqlitePackageJson);
const bindingPath = path.join(
  betterSqliteRoot,
  "bin",
  `${process.platform}-${process.arch}-${electronAbi}`,
  "better-sqlite3.node",
);

if (fs.existsSync(bindingPath)) {
  process.exit(0);
}

console.log(
  `[native] missing Electron better-sqlite3 binding for ABI ${electronAbi}; rebuilding from source`,
);
const result = spawnSync("pnpm", ["native:electron:sqlite"], {
  stdio: "inherit",
  env: process.env,
});

if (result.error) {
  console.error(result.error);
  process.exit(1);
}
process.exit(result.status ?? 1);
