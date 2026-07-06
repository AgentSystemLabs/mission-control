import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Read a JSON settings file that may not exist yet. Returns the parsed object,
 * an empty object when the file is missing (ENOENT — expected on first write),
 * or `null` to signal the caller should abort WITHOUT clobbering the file
 * (parse failure, permission denied, or any other read error).
 */
export function readJsonSettingsFile<T extends object>(file: string): T | null {
  try {
    const raw = fs.readFileSync(file, "utf8");
    return raw.trim() ? (JSON.parse(raw) as T) : ({} as T);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return {} as T;
    return null;
  }
}

/**
 * Write `value` as pretty-printed JSON (2-space indent, trailing newline),
 * creating the parent directory if needed. Best-effort: returns `false` if the
 * write fails rather than throwing.
 */
export function writeJsonSettingsFile(file: string, value: unknown): boolean {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n", "utf8");
    return true;
  } catch {
    return false;
  }
}
