import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Mirror of electron/file-handlers.ts `resolveInsideRoot`, generalized to the
 * sandbox workspace prefix. Returns the resolved absolute path if `target`
 * stays inside `workspaceRoot`, or null on any escape attempt:
 *  - NUL byte in the path
 *  - lexical `..` / absolute escape outside the root
 *  - symlink whose realpath escapes the root
 *
 * For paths that don't exist yet (e.g. a write target or clone destination) the
 * lexical containment check still applies; the absolute path is returned.
 */
export function resolveInsideWorkspace(workspaceRoot: string, target: string): string | null {
  if (typeof target !== "string" || target.includes("\0")) return null;

  const abs = path.resolve(workspaceRoot, target);
  const rel = path.relative(workspaceRoot, abs);
  if (rel === ".." || rel.startsWith(".." + path.sep) || path.isAbsolute(rel)) {
    return null;
  }

  let realRoot: string;
  try {
    realRoot = fs.realpathSync(workspaceRoot);
  } catch {
    realRoot = workspaceRoot;
  }

  try {
    const real = fs.realpathSync(abs);
    const realRel = path.relative(realRoot, real);
    if (realRel === ".." || realRel.startsWith(".." + path.sep) || path.isAbsolute(realRel)) {
      return null;
    }
    return real;
  } catch {
    // Target does not exist yet — lexical containment already proven above.
    return abs;
  }
}

export function isInsideWorkspace(workspaceRoot: string, target: string): boolean {
  return resolveInsideWorkspace(workspaceRoot, target) !== null;
}

const SAFE_SLUG = /^[a-z0-9][a-z0-9._-]*$/i;

/** A clone destination slug must be a single safe path segment (no separators, no `..`). */
export function isSafeSlug(slug: string): boolean {
  return (
    typeof slug === "string" &&
    slug.length > 0 &&
    slug.length <= 200 &&
    !slug.includes("/") &&
    !slug.includes("\\") &&
    slug !== "." &&
    slug !== ".." &&
    SAFE_SLUG.test(slug)
  );
}
