import * as fs from "node:fs";
import * as path from "node:path";

// Synchronous filesystem primitives shared by the ensure-*-skill installers.
// They run on the PTY spawn path, so everything here is fail-soft by contract:
// callers wrap installs in try/catch and never let a skill copy block a spawn.

export const SKILL_MANIFEST_FILENAME = "SKILL.md";

/** Whether `dir` holds an installed skill (its SKILL.md exists). */
export function hasSkillManifest(dir: string): boolean {
  return fs.existsSync(path.join(dir, SKILL_MANIFEST_FILENAME));
}

/** The first candidate directory that contains a SKILL.md, or null. */
export function findBundledSkillSource(candidates: readonly string[]): string | null {
  for (const candidate of candidates) {
    if (hasSkillManifest(candidate)) return candidate;
  }
  return null;
}

/** Recursively copy regular files from `sourceDir` into `targetDir` (created if missing). */
export function copySkillTreeSync(sourceDir: string, targetDir: string): void {
  fs.mkdirSync(targetDir, { recursive: true });
  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    const from = path.join(sourceDir, entry.name);
    const to = path.join(targetDir, entry.name);
    if (entry.isDirectory()) {
      copySkillTreeSync(from, to);
      continue;
    }
    if (!entry.isFile()) continue;
    fs.copyFileSync(from, to);
  }
}

/**
 * Install `sourceDir` into each target that doesn't already carry a SKILL.md.
 * A target with a manifest is left untouched (it may be user-authored); one
 * without is replaced wholesale. Per-target failures are swallowed.
 */
export function installSkillWhereMissing(sourceDir: string, targetDirs: readonly string[]): void {
  for (const targetDir of targetDirs) {
    if (hasSkillManifest(targetDir)) continue;
    try {
      fs.rmSync(targetDir, { recursive: true, force: true });
      copySkillTreeSync(sourceDir, targetDir);
    } catch {
      /* swallow — skill install must never block PTY spawn */
    }
  }
}
