import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import * as tar from "tar";
import { getLicenseState } from "~/db/settings";
import { resolveUserDataDir } from "~/db/client";
import { ACADEMY_BASE_URL, isAllowedAcademyDownloadUrl } from "~/shared/academy";
import { isAcademyTier } from "~/shared/license";
import { isPickedDirAllowed } from "~/shared/picked-dirs";
import { createProject } from "./projects";
import { readLicenseState } from "./license";
import { logger } from "~/shared/logger";

export class LaunchKitAuthorizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LaunchKitAuthorizationError";
  }
}

export type LatestLaunchKitManifest = {
  version: string;
  downloadUrl: string;
  sha256: string;
  size: number;
};

export type CreateLaunchKitProjectResult = {
  project: Awaited<ReturnType<typeof createProject>>;
  version: string;
};

function readRequiredAcademyLicenseKey(): string {
  const state = readLicenseState();
  if (!isAcademyTier(state)) {
    throw new Error("Academy access is required to download the Launch Kit.");
  }
  const key = getLicenseState().key?.trim();
  if (!key) {
    throw new Error("A valid Academy license key is required.");
  }
  return key;
}

function licenseAuthHeaders(key: string): HeadersInit {
  return { authorization: `Bearer ${key}` };
}

export async function readLaunchKitAccess(): Promise<{ hasAccess: boolean }> {
  const state = readLicenseState();
  if (isAcademyTier(state)) return { hasAccess: true };

  const key = getLicenseState().key?.trim();
  if (!key || state.status !== "active") return { hasAccess: false };

  try {
    const url = `${ACADEMY_BASE_URL.replace(/\/$/, "")}/api/launch-kit/access`;
    const res = await fetch(url, { headers: licenseAuthHeaders(key) });
    return { hasAccess: res.ok };
  } catch {
    return { hasAccess: false };
  }
}

function validateProjectName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Project name is required");
  if (trimmed === "." || trimmed === "..") {
    throw new Error("Project name cannot be . or ..");
  }
  if (trimmed.includes("/") || trimmed.includes("\\") || trimmed.includes("\0")) {
    throw new Error("Project name cannot contain path separators");
  }
  return trimmed;
}

function normalizeEntryPath(p: string): string | null {
  const s = p.replace(/\\/g, "/").replace(/^\.\//, "");
  if (!s || s.startsWith("/") || s.includes("\0")) return null;
  if (s.split("/").some((part) => part === "..")) return null;
  return s;
}

function isSafeTarEntry(entry: { path: string; type?: string }): boolean {
  const type = entry.type;
  if (
    type &&
    type !== "File" &&
    type !== "Directory" &&
    type !== "OldFile" &&
    type !== "ContiguousFile"
  ) {
    return false;
  }
  return normalizeEntryPath(entry.path) !== null;
}

export async function fetchLatestLaunchKitManifest(): Promise<LatestLaunchKitManifest> {
  const licenseKey = readRequiredAcademyLicenseKey();
  const url = `${ACADEMY_BASE_URL.replace(/\/$/, "")}/api/launch-kit/latest`;
  const res = await fetch(url, { headers: licenseAuthHeaders(licenseKey) });
  if (!res.ok) {
    throw new Error(
      `Failed to fetch latest Launch Kit manifest: ${res.status} ${res.statusText}`,
    );
  }
  const json = (await res.json()) as Partial<LatestLaunchKitManifest>;
  if (
    typeof json.version !== "string" ||
    typeof json.downloadUrl !== "string" ||
    typeof json.sha256 !== "string" ||
    typeof json.size !== "number"
  ) {
    throw new Error("Latest Launch Kit manifest is malformed");
  }
  return json as LatestLaunchKitManifest;
}

export async function createProjectFromLaunchKit(input: {
  parentDir: string;
  projectName: string;
}): Promise<CreateLaunchKitProjectResult> {
  const parentDir = input.parentDir.trim();
  if (!parentDir) throw new Error("Working directory is required");
  const parentStat = await fs.promises.stat(parentDir).catch(() => null);
  if (!parentStat || !parentStat.isDirectory()) {
    throw new Error("Working directory must be an existing directory");
  }

  // Authorize the parent directory: a renderer-supplied absolute path is only
  // honored if the Electron main process recently issued it via the native
  // directory picker (dialog:pickProjectParentDir). Realpath both sides to
  // defeat symlink trickery.
  let realParent: string;
  try {
    realParent = await fs.promises.realpath(parentDir);
  } catch {
    realParent = path.resolve(parentDir);
  }
  if (!isPickedDirAllowed(resolveUserDataDir(), realParent)) {
    throw new LaunchKitAuthorizationError(
      "Working directory was not selected via the native folder picker. Click Browse to choose a folder.",
    );
  }

  const projectName = validateProjectName(input.projectName);
  const targetDir = path.join(parentDir, projectName);
  const existing = await fs.promises.stat(targetDir).catch(() => null);
  if (existing) {
    throw new Error("A file or folder already exists at the project path");
  }

  const manifest = await fetchLatestLaunchKitManifest();
  if (!isAllowedAcademyDownloadUrl(manifest.downloadUrl)) {
    throw new Error(`Refusing to download from untrusted host: ${manifest.downloadUrl}`);
  }
  const licenseKey = readRequiredAcademyLicenseKey();
  const tempFile = path.join(
    os.tmpdir(),
    `mc-launch-kit-${manifest.version}-${crypto.randomBytes(6).toString("hex")}.tar.gz`,
  );

  let createdTarget = false;
  try {
    const dlRes = await fetch(manifest.downloadUrl, {
      headers: licenseAuthHeaders(licenseKey),
    });
    if (!dlRes.ok || !dlRes.body) {
      throw new Error(
        `Failed to download Launch Kit: ${dlRes.status} ${dlRes.statusText}`,
      );
    }

    const hash = crypto.createHash("sha256");
    const fileStream = fs.createWriteStream(tempFile);
    const nodeStream = Readable.fromWeb(
      dlRes.body as unknown as import("stream/web").ReadableStream,
    );
    nodeStream.on("data", (chunk: Buffer | string) => {
      hash.update(chunk);
    });
    await pipeline(nodeStream, fileStream);
    const got = hash.digest("hex");
    if (got.toLowerCase() !== manifest.sha256.toLowerCase()) {
      throw new Error(
        `Launch Kit sha256 mismatch: expected ${manifest.sha256}, got ${got}`,
      );
    }

    const allowedEntries = new Set<string>();
    await tar.list({
      file: tempFile,
      onentry: (entry) => {
        const candidate = entry as unknown as { path: string; type?: string };
        if (!isSafeTarEntry(candidate)) return;
        const normalized = normalizeEntryPath(candidate.path);
        if (normalized) allowedEntries.add(normalized);
      },
    });

    await fs.promises.mkdir(targetDir);
    createdTarget = true;

    await tar.extract({
      file: tempFile,
      cwd: targetDir,
      filter: (filePath) => {
        const normalized = normalizeEntryPath(filePath);
        return !!normalized && allowedEntries.has(normalized);
      },
    });

    const git = spawnSync("git", ["init"], {
      cwd: targetDir,
      encoding: "utf8",
      timeout: 15_000,
    });
    if (git.status !== 0) {
      throw new Error(git.stderr || "git init failed");
    }

    const project = await createProject({
      name: projectName,
      path: targetDir,
      icon: projectName.slice(0, 2).toUpperCase(),
      iconColor: "#ff5a1f",
    });

    return { project, version: manifest.version };
  } catch (err) {
    if (createdTarget) {
      await fs.promises.rm(targetDir, { recursive: true, force: true }).catch((rmErr) => {
        logger.warn("failed to clean temp tarball", { err: rmErr, tempFile: targetDir });
      });
    }
    throw err;
  } finally {
    await fs.promises.rm(tempFile, { force: true }).catch((rmErr) => {
      logger.warn("failed to clean temp tarball", { err: rmErr, tempFile });
    });
  }
}
