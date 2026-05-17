import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const CLIENT_DIRS = ["src/lib", "src/components", "src/routes"].map((dir) =>
  path.join(ROOT, dir),
);
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx"]);
const NON_TYPE_SERVER_IMPORT =
  /import\s+(?!type\b)[^;]*\bfrom\s+["']~\/server(?:\/[^"']*)?["'];?/g;
const DYNAMIC_SERVER_IMPORT = /import\s*\(\s*["']~\/server(?:\/[^"']*)?["']\s*\)/g;

function sourceFiles(dir: string): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(fullPath);
    return SOURCE_EXTENSIONS.has(path.extname(entry.name)) ? [fullPath] : [];
  });
}

describe("client/server import boundary", () => {
  it("keeps server modules out of client-facing source files", () => {
    const violations = CLIENT_DIRS.flatMap(sourceFiles).flatMap((file) => {
      const source = fs.readFileSync(file, "utf8");
      const matches = [
        ...source.matchAll(NON_TYPE_SERVER_IMPORT),
        ...source.matchAll(DYNAMIC_SERVER_IMPORT),
      ];
      return matches.map((match) => `${path.relative(ROOT, file)}: ${match[0]}`);
    });

    expect(violations).toEqual([]);
  });
});
