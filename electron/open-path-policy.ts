import * as fs from "node:fs";
import * as path from "node:path";

export type OpenPathDecision =
  | { ok: true; path: string }
  | { ok: false; error: string };

const DANGEROUS_OPEN_EXTENSIONS = new Set([
  ".app",
  ".bat",
  ".cmd",
  ".com",
  ".command",
  ".desktop",
  ".dmg",
  ".docm",
  ".dotm",
  ".exe",
  ".jar",
  ".lnk",
  ".msi",
  ".pkg",
  ".potm",
  ".pptm",
  ".ps1",
  ".scr",
  ".sh",
  ".xlsm",
  ".xltm",
]);

function withinRoot(candidate: string, root: string): boolean {
  const rel = path.relative(root, candidate);
  return rel === "" || (!!rel && !rel.startsWith("..") && !path.isAbsolute(rel));
}

function realpathIfPossible(p: string): string | null {
  try {
    return fs.realpathSync(p);
  } catch {
    return null;
  }
}

export function resolveSafeOpenPath(
  requestedPath: string,
  projectRoots: readonly string[],
): OpenPathDecision {
  if (!requestedPath) return { ok: false, error: "empty" };
  if (requestedPath.includes("\0")) return { ok: false, error: "invalid-path" };

  const realTarget = realpathIfPossible(requestedPath);
  if (!realTarget) return { ok: false, error: "path-not-found" };

  const realRoots = projectRoots
    .map(realpathIfPossible)
    .filter((root): root is string => !!root);
  if (!realRoots.some((root) => withinRoot(realTarget, root))) {
    return { ok: false, error: "path-outside-project-roots" };
  }

  const ext = path.extname(realTarget).toLowerCase();
  if (DANGEROUS_OPEN_EXTENSIONS.has(ext)) {
    return { ok: false, error: "dangerous-file-type" };
  }

  const stat = fs.statSync(realTarget);
  if (!stat.isDirectory()) {
    return { ok: false, error: "files-not-supported" };
  }

  return { ok: true, path: realTarget };
}
