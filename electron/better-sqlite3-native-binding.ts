import * as fs from "node:fs";
import * as path from "node:path";

export function resolveElectronBetterSqlite3NativeBinding(): string | undefined {
  if (!process.versions.electron) return undefined;
  const packageJsonPath = require.resolve("better-sqlite3/package.json");
  const packageRoot = path.dirname(packageJsonPath);
  const candidate = path.join(
    packageRoot,
    "bin",
    `${process.platform}-${process.arch}-${process.versions.modules}`,
    "better-sqlite3.node",
  );
  if (fs.existsSync(candidate)) return candidate;
  throw new Error(
    `Electron better-sqlite3 native binding not found at ${candidate}. Run pnpm native:electron:sqlite.`,
  );
}
