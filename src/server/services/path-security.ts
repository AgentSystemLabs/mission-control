import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { resolveUserDataDir } from "~/db/client";
import { findAllProjects } from "../repositories/projects.repo";

const DIRECTORY_GRANTS_FILE = "directory-grants.json";
export const DIRECTORY_GRANT_TTL_MS = 15 * 60_000;

type DirectoryGrant = {
  path: string;
  createdAt: number;
};

type DirectoryGrantsFile = {
  grants?: DirectoryGrant[];
};

function realpathDirectory(dir: string, label: string): string {
  const trimmed = dir.trim();
  if (!trimmed) throw new Error(`${label} is required`);
  const stat = fs.statSync(trimmed);
  if (!stat.isDirectory()) throw new Error(`${label} is not a directory: ${dir}`);
  return fs.realpathSync(trimmed);
}

function samePath(a: string, b: string): boolean {
  return path.resolve(a) === path.resolve(b);
}

function withinOrEqual(candidate: string, root: string): boolean {
  const rel = path.relative(root, candidate);
  return rel === "" || (!!rel && !rel.startsWith("..") && !path.isAbsolute(rel));
}

function grantFilePath(userDataDir = resolveUserDataDir()): string {
  return path.join(userDataDir, DIRECTORY_GRANTS_FILE);
}

function readGrantFile(userDataDir = resolveUserDataDir()): DirectoryGrant[] {
  try {
    const parsed = JSON.parse(fs.readFileSync(grantFilePath(userDataDir), "utf8")) as DirectoryGrantsFile;
    if (!Array.isArray(parsed.grants)) return [];
    return parsed.grants.filter(
      (g): g is DirectoryGrant =>
        typeof g?.path === "string" &&
        g.path.length > 0 &&
        typeof g.createdAt === "number" &&
        Number.isFinite(g.createdAt),
    );
  } catch {
    return [];
  }
}

function writeGrantFile(grants: DirectoryGrant[], userDataDir = resolveUserDataDir()): void {
  fs.mkdirSync(userDataDir, { recursive: true });
  const target = grantFilePath(userDataDir);
  const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ grants }, null, 2), "utf8");
  fs.renameSync(tmp, target);
}

function activeGrants(
  grants: DirectoryGrant[],
  now = Date.now(),
): DirectoryGrant[] {
  return grants.filter(
    (g) => g.createdAt <= now && now - g.createdAt <= DIRECTORY_GRANT_TTL_MS,
  );
}

export function grantLaunchKitParentDirectory(
  parentDir: string,
  userDataDir = resolveUserDataDir(),
  now = Date.now(),
): string {
  const realParent = realpathDirectory(parentDir, "parentDir");
  const grants = activeGrants(readGrantFile(userDataDir), now).filter(
    (g) => !samePath(g.path, realParent),
  );
  grants.push({ path: realParent, createdAt: now });
  writeGrantFile(grants, userDataDir);
  return realParent;
}

export function resolveRegisteredProjectPath(projectPath: string): string {
  let realProjectPath: string;
  try {
    realProjectPath = realpathDirectory(projectPath, "projectPath");
  } catch {
    throw new Error(`projectPath is not a directory: ${projectPath}`);
  }

  for (const project of findAllProjects()) {
    try {
      if (samePath(realProjectPath, fs.realpathSync(project.path))) {
        return realProjectPath;
      }
    } catch {
      // Ignore stale project rows; they should not grant writes anywhere.
    }
  }
  throw new Error("projectPath must be a registered Mission Control project");
}

function realHome(): string {
  try {
    return fs.realpathSync(os.homedir());
  } catch {
    return path.resolve(os.homedir());
  }
}

function forbiddenLaunchKitRoots(): string[] {
  const home = realHome();
  const roots = [
    home,
    path.join(home, "Library"),
    path.join(home, ".config"),
    path.join(home, ".local"),
    path.join(home, "AppData"),
  ];
  if (process.platform === "win32") {
    roots.push("C:\\Windows", "C:\\Program Files", "C:\\Program Files (x86)");
  } else {
    roots.push(
      "/Applications",
      "/usr",
      "/etc",
      "/private/etc",
      "/System",
      "/Library",
    );
  }
  return [
    ...new Set(
      roots.flatMap((root) => {
        const resolved = path.resolve(root);
        try {
          return [resolved, path.resolve(fs.realpathSync(root))];
        } catch {
          return [resolved];
        }
      }),
    ),
  ];
}

function isForbiddenLaunchKitParent(realParent: string): boolean {
  const resolved = path.resolve(realParent);
  const rootDir = path.parse(resolved).root;
  if (samePath(resolved, rootDir)) return true;
  return forbiddenLaunchKitRoots().some((root) => withinOrEqual(resolved, root));
}

export function resolveLaunchKitParentDirectory(
  parentDir: string,
  userDataDir = resolveUserDataDir(),
  now = Date.now(),
): string {
  let realParent: string;
  try {
    realParent = realpathDirectory(parentDir, "parentDir");
  } catch {
    throw new Error("Working directory must be an existing directory");
  }

  if (isForbiddenLaunchKitParent(realParent)) {
    throw new Error("Working directory is not allowed for Launch Kit projects");
  }

  const allGrants = readGrantFile(userDataDir);
  const grants = activeGrants(allGrants, now);
  const hasGrant = grants.some((g) => samePath(g.path, realParent));
  if (grants.length !== allGrants.length) {
    writeGrantFile(grants, userDataDir);
  }
  if (!hasGrant) {
    throw new Error("Working directory must be selected with the folder picker before creating a Launch Kit project");
  }
  return realParent;
}
