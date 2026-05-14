import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";
import * as crypto from "node:crypto";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import * as tar from "tar";
import { ACADEMY_BASE_URL, isAllowedAcademyDownloadUrl } from "~/shared/academy";
import { logger } from "~/shared/logger";
import { getSetting } from "./settings";
import {
  executeRuntimeCommand,
  getRuntimeWorkspacePath,
  readRuntimeFile,
  writeRuntimeFileBuffer,
} from "../runtime/daytona";

export type LatestSkillsManifest = {
  version: string;
  downloadUrl: string;
  sha256: string;
  size: number;
};

export type InstallSkillsArgs = {
  projectPath: string;
  harnesses: { claude: boolean; codex: boolean };
};

export type InstallSkillsResult = {
  version: string;
  claudeInstalled: boolean;
  codexInstalled: boolean;
  skillCount: number;
};

const ALLOWED_PREFIXES = [".claude/skills/", ".codex/skills/"] as const;
const VERSION_MANIFEST_PATH = ".agentsystem/skills-version.json";
const MAX_SKILLS_TARBALL_BYTES = 50 * 1024 * 1024;
const MAX_EXTRACTED_SKILL_BYTES = 100 * 1024 * 1024;
const MAX_EXTRACTED_SKILL_FILE_BYTES = 5 * 1024 * 1024;
const MAX_EXTRACTED_SKILL_FILES = 2000;
const runtimeInstallLocks = new Map<string, Promise<unknown>>();

async function readRequiredLicenseKey(userId?: string | null): Promise<string> {
  const key = (await getSetting("license_key", { userId }))?.trim();
  if (!key) {
    throw new Error("A valid license key is required to install skills.");
  }
  return key;
}

function licenseAuthHeaders(key: string): HeadersInit {
  return { authorization: `Bearer ${key}` };
}

function normalizeEntryPath(p: string): string | null {
  const s = p.replace(/\\/g, "/").replace(/^\.\//, "");
  if (s.startsWith("/")) return null;
  if (s.split("/").some((part) => part === "..")) return null;
  return s;
}

function entryAllowed(
  normPath: string,
  harnesses: { claude: boolean; codex: boolean },
): boolean {
  // Always extract the version manifest so we can detect outdated installs.
  if (normPath === VERSION_MANIFEST_PATH) return true;
  if (normPath.startsWith(".claude/skills/")) return harnesses.claude;
  if (normPath.startsWith(".codex/skills/")) return harnesses.codex;
  return false;
}

export type InstalledSkillsVersion = {
  version: string | null;
  publishedAt: string | null;
};

export function readInstalledSkillsVersion(
  projectPath: string,
): InstalledSkillsVersion {
  if (!projectPath || typeof projectPath !== "string") {
    return { version: null, publishedAt: null };
  }
  try {
    const file = path.join(projectPath, ".agentsystem", "skills-version.json");
    const raw = fs.readFileSync(file, "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return { version: null, publishedAt: null };
    }
    const p = parsed as { version?: unknown; publishedAt?: unknown };
    return {
      version: typeof p.version === "string" ? p.version : null,
      publishedAt: typeof p.publishedAt === "string" ? p.publishedAt : null,
    };
  } catch {
    return { version: null, publishedAt: null };
  }
}

export async function readInstalledSkillsVersionForProject(
  project: { id: string; path: string; runtimeKind?: string | null },
): Promise<InstalledSkillsVersion> {
  if (project.runtimeKind && project.runtimeKind !== "local") {
    const result = await readRuntimeFile(project.id, VERSION_MANIFEST_PATH);
    if (!result.ok) return { version: null, publishedAt: null };
    return parseInstalledSkillsVersion(result.content);
  }
  return readInstalledSkillsVersion(project.path);
}

function parseInstalledSkillsVersion(raw: string): InstalledSkillsVersion {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return { version: null, publishedAt: null };
    }
    const p = parsed as { version?: unknown; publishedAt?: unknown };
    return {
      version: typeof p.version === "string" ? p.version : null,
      publishedAt: typeof p.publishedAt === "string" ? p.publishedAt : null,
    };
  } catch {
    return { version: null, publishedAt: null };
  }
}

export async function fetchLatestSkillsManifest(userId?: string | null): Promise<LatestSkillsManifest> {
  const licenseKey = await readRequiredLicenseKey(userId);
  const url = `${ACADEMY_BASE_URL.replace(/\/$/, "")}/api/skills/latest`;
  const res = await fetch(url, { headers: licenseAuthHeaders(licenseKey) });
  if (!res.ok) {
    throw new Error(
      `Failed to fetch latest skills manifest: ${res.status} ${res.statusText}`,
    );
  }
  const json: unknown = await res.json();
  if (!json || typeof json !== "object") {
    throw new Error("Latest skills manifest is malformed");
  }
  const m = json as Partial<LatestSkillsManifest>;
  if (
    typeof m.version !== "string" ||
    typeof m.downloadUrl !== "string" ||
    typeof m.sha256 !== "string" ||
    typeof m.size !== "number"
  ) {
    throw new Error("Latest skills manifest is malformed");
  }
  return { version: m.version, downloadUrl: m.downloadUrl, sha256: m.sha256, size: m.size };
}

export async function installProjectSkills(
  args: InstallSkillsArgs,
  userId?: string | null,
): Promise<InstallSkillsResult> {
  const { projectPath, harnesses } = args;

  if (!projectPath || typeof projectPath !== "string" || !projectPath.trim()) {
    throw new Error("projectPath is required");
  }
  if (!harnesses.claude && !harnesses.codex) {
    throw new Error("Select at least one harness");
  }
  const projectStat = await fs.promises.stat(projectPath).catch(() => null);
  if (!projectStat || !projectStat.isDirectory()) {
    throw new Error(`projectPath is not a directory: ${projectPath}`);
  }

  const manifest = await fetchLatestSkillsManifest(userId);
  validateManifestSize(manifest);
  if (!isAllowedAcademyDownloadUrl(manifest.downloadUrl)) {
    throw new Error(`Refusing to download from untrusted host: ${manifest.downloadUrl}`);
  }
  const licenseKey = await readRequiredLicenseKey(userId);

  const tempFile = path.join(
    os.tmpdir(),
    `mc-skills-${manifest.version}-${crypto.randomBytes(6).toString("hex")}.tar.gz`,
  );

  try {
    const dlRes = await fetch(manifest.downloadUrl, {
      headers: licenseAuthHeaders(licenseKey),
    });
    if (!dlRes.ok || !dlRes.body) {
      throw new Error(
        `Failed to download skills tarball: ${dlRes.status} ${dlRes.statusText}`,
      );
    }
    validateDownloadLength(dlRes, manifest);
    const hash = crypto.createHash("sha256");
    const fileStream = fs.createWriteStream(tempFile);
    let bytesRead = 0;
    const nodeStream = Readable.fromWeb(
      dlRes.body as unknown as import("stream/web").ReadableStream,
    );
    nodeStream.on("data", (chunk: Buffer | string) => {
      bytesRead += Buffer.byteLength(chunk);
      if (bytesRead > manifest.size || bytesRead > MAX_SKILLS_TARBALL_BYTES) {
        nodeStream.destroy(new Error("Skills tarball exceeded manifest size"));
        return;
      }
      hash.update(chunk);
    });
    await pipeline(nodeStream, fileStream);
    if (bytesRead !== manifest.size) {
      throw new Error(`Tarball size mismatch: expected ${manifest.size}, got ${bytesRead}`);
    }
    const got = hash.digest("hex");
    if (got.toLowerCase() !== manifest.sha256.toLowerCase()) {
      throw new Error(
        `Tarball sha256 mismatch: expected ${manifest.sha256}, got ${got}`,
      );
    }

    const skillDirsByHarness = {
      claude: new Set<string>(),
      codex: new Set<string>(),
    };
    const allowedEntries = new Set<string>();
    await tar.list({
      file: tempFile,
      onentry: (entry) => {
        const t = (entry as unknown as { type?: string }).type;
        if (t && t !== "File" && t !== "Directory" && t !== "OldFile" && t !== "ContiguousFile") return;
        const norm = normalizeEntryPath(entry.path as unknown as string);
        if (!norm) return;
        if (!entryAllowed(norm, harnesses)) return;
        allowedEntries.add(norm);
        for (const prefix of ALLOWED_PREFIXES) {
          if (norm.startsWith(prefix)) {
            const rest = norm.slice(prefix.length);
            const skillName = rest.split("/")[0];
            if (skillName) {
              if (prefix === ".claude/skills/")
                skillDirsByHarness.claude.add(skillName);
              else skillDirsByHarness.codex.add(skillName);
            }
            break;
          }
        }
      },
    });

    for (const skill of skillDirsByHarness.claude) {
      await fs.promises.rm(path.join(projectPath, ".claude", "skills", skill), {
        recursive: true,
        force: true,
      });
    }
    for (const skill of skillDirsByHarness.codex) {
      await fs.promises.rm(path.join(projectPath, ".codex", "skills", skill), {
        recursive: true,
        force: true,
      });
    }

    await tar.extract({
      file: tempFile,
      cwd: projectPath,
      onentry: createExtractionLimiter(),
      filter: (filePath) => {
        const norm = normalizeEntryPath(filePath);
        if (!norm) return false;
        return allowedEntries.has(norm);
      },
    });

    let skillCount = 0;
    if (harnesses.claude) skillCount += skillDirsByHarness.claude.size;
    if (harnesses.codex) skillCount += skillDirsByHarness.codex.size;

    return {
      version: manifest.version,
      claudeInstalled: harnesses.claude && skillDirsByHarness.claude.size > 0,
      codexInstalled: harnesses.codex && skillDirsByHarness.codex.size > 0,
      skillCount,
    };
  } finally {
    await fs.promises.rm(tempFile, { force: true }).catch((err) => {
      logger.warn("failed to clean temp tarball", { err, tempFile });
    });
  }
}

export async function installProjectSkillsInRuntime(
  args: { projectId: string; harnesses: { claude: boolean; codex: boolean } },
  userId?: string | null,
): Promise<InstallSkillsResult> {
  return withRuntimeInstallLock(args.projectId, async () =>
    installProjectSkillsInRuntimeUnlocked(args, userId),
  );
}

async function installProjectSkillsInRuntimeUnlocked(
  args: { projectId: string; harnesses: { claude: boolean; codex: boolean } },
  userId?: string | null,
): Promise<InstallSkillsResult> {
  const { projectId, harnesses } = args;
  if (!harnesses.claude && !harnesses.codex) {
    throw new Error("Select at least one harness");
  }

  const manifest = await fetchLatestSkillsManifest(userId);
  validateManifestSize(manifest);
  if (!isAllowedAcademyDownloadUrl(manifest.downloadUrl)) {
    throw new Error(`Refusing to download from untrusted host: ${manifest.downloadUrl}`);
  }
  const licenseKey = await readRequiredLicenseKey(userId);
  const tempFile = path.join(
    os.tmpdir(),
    `mc-skills-${manifest.version}-${crypto.randomBytes(6).toString("hex")}.tar.gz`,
  );
  const tempDir = path.join(
    os.tmpdir(),
    `mc-skills-${manifest.version}-${crypto.randomBytes(6).toString("hex")}`,
  );

  try {
    const dlRes = await fetch(manifest.downloadUrl, {
      headers: licenseAuthHeaders(licenseKey),
    });
    if (!dlRes.ok || !dlRes.body) {
      throw new Error(
        `Failed to download skills tarball: ${dlRes.status} ${dlRes.statusText}`,
      );
    }
    validateDownloadLength(dlRes, manifest);
    const hash = crypto.createHash("sha256");
    const fileStream = fs.createWriteStream(tempFile);
    let bytesRead = 0;
    const nodeStream = Readable.fromWeb(
      dlRes.body as unknown as import("stream/web").ReadableStream,
    );
    nodeStream.on("data", (chunk: Buffer | string) => {
      bytesRead += Buffer.byteLength(chunk);
      if (bytesRead > manifest.size || bytesRead > MAX_SKILLS_TARBALL_BYTES) {
        nodeStream.destroy(new Error("Skills tarball exceeded manifest size"));
        return;
      }
      hash.update(chunk);
    });
    await pipeline(nodeStream, fileStream);
    if (bytesRead !== manifest.size) {
      throw new Error(`Tarball size mismatch: expected ${manifest.size}, got ${bytesRead}`);
    }
    const got = hash.digest("hex");
    if (got.toLowerCase() !== manifest.sha256.toLowerCase()) {
      throw new Error(
        `Tarball sha256 mismatch: expected ${manifest.sha256}, got ${got}`,
      );
    }

    const { allowedEntries, skillDirsByHarness } = await inspectSkillsTarball(tempFile, harnesses);
    await fs.promises.mkdir(tempDir, { recursive: true });
    await tar.extract({
      file: tempFile,
      cwd: tempDir,
      onentry: createExtractionLimiter(),
      filter: (filePath) => {
        const norm = normalizeEntryPath(filePath);
        if (!norm) return false;
        return allowedEntries.has(norm);
      },
    });

    const workspacePath = await getRuntimeWorkspacePath(projectId);
    const stagingRel = `.agentsystem/tmp/skills-install-${crypto.randomBytes(6).toString("hex")}`;
    const stagingAbs = path.posix.join(workspacePath, stagingRel);
    const dirsToRemove = [
      ...[...skillDirsByHarness.claude].map((skill) => `.claude/skills/${skill}`),
      ...[...skillDirsByHarness.codex].map((skill) => `.codex/skills/${skill}`),
    ];

    const files = await walkExtractedFiles(tempDir);
    const dirs = new Set(files.map((file) => path.posix.dirname(path.posix.join(stagingRel, file))).filter((dir) => dir !== "."));
    if (dirs.size > 0) {
      await executeRuntimeCommand(
        projectId,
        `mkdir -p -- ${[...dirs].map((rel) => shellQuote(path.posix.join(workspacePath, rel))).join(" ")}`,
        { timeoutMs: 30_000 },
      );
    }
    for (const rel of files) {
      const buf = await fs.promises.readFile(path.join(tempDir, rel));
      await writeRuntimeFileBuffer(projectId, path.posix.join(stagingRel, rel), buf);
    }

    const removeTargets = dirsToRemove
      .map((rel) => shellQuote(path.posix.join(workspacePath, rel)))
      .join(" ");
    const swapScript = [
      "set -e",
      `cd ${shellQuote(workspacePath)}`,
      removeTargets ? `rm -rf -- ${removeTargets}` : ":",
      `[ -d ${shellQuote(path.posix.join(stagingAbs, ".claude"))} ] && mkdir -p .claude && cp -a ${shellQuote(path.posix.join(stagingAbs, ".claude"))}/. .claude/ || true`,
      `[ -d ${shellQuote(path.posix.join(stagingAbs, ".codex"))} ] && mkdir -p .codex && cp -a ${shellQuote(path.posix.join(stagingAbs, ".codex"))}/. .codex/ || true`,
      `[ -f ${shellQuote(path.posix.join(stagingAbs, VERSION_MANIFEST_PATH))} ] && mkdir -p .agentsystem && cp ${shellQuote(path.posix.join(stagingAbs, VERSION_MANIFEST_PATH))} .agentsystem/skills-version.json || true`,
      `rm -rf -- ${shellQuote(stagingAbs)}`,
    ].join("; ");
    await executeRuntimeCommand(projectId, swapScript, { timeoutMs: 30_000 });

    let skillCount = 0;
    if (harnesses.claude) skillCount += skillDirsByHarness.claude.size;
    if (harnesses.codex) skillCount += skillDirsByHarness.codex.size;
    return {
      version: manifest.version,
      claudeInstalled: harnesses.claude && skillDirsByHarness.claude.size > 0,
      codexInstalled: harnesses.codex && skillDirsByHarness.codex.size > 0,
      skillCount,
    };
  } finally {
    await Promise.all([
      fs.promises.rm(tempFile, { force: true }).catch((err) => {
        logger.warn("failed to clean temp tarball", { err, tempFile });
      }),
      fs.promises.rm(tempDir, { recursive: true, force: true }).catch((err) => {
        logger.warn("failed to clean temp skills dir", { err, tempDir });
      }),
    ]);
  }
}

async function withRuntimeInstallLock<T>(projectId: string, fn: () => Promise<T>): Promise<T> {
  const previous = runtimeInstallLocks.get(projectId) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(fn);
  runtimeInstallLocks.set(projectId, next);
  try {
    return await next;
  } finally {
    if (runtimeInstallLocks.get(projectId) === next) runtimeInstallLocks.delete(projectId);
  }
}

async function inspectSkillsTarball(
  tempFile: string,
  harnesses: { claude: boolean; codex: boolean },
) {
  const skillDirsByHarness = {
    claude: new Set<string>(),
    codex: new Set<string>(),
  };
  const allowedEntries = new Set<string>();
  await tar.list({
    file: tempFile,
    onentry: (entry) => {
      const t = (entry as unknown as { type?: string }).type;
      if (t && t !== "File" && t !== "Directory" && t !== "OldFile" && t !== "ContiguousFile") return;
      const norm = normalizeEntryPath(entry.path as unknown as string);
      if (!norm) return;
      if (!entryAllowed(norm, harnesses)) return;
      allowedEntries.add(norm);
      for (const prefix of ALLOWED_PREFIXES) {
        if (norm.startsWith(prefix)) {
          const rest = norm.slice(prefix.length);
          const skillName = rest.split("/")[0];
          if (skillName) {
            if (prefix === ".claude/skills/")
              skillDirsByHarness.claude.add(skillName);
            else skillDirsByHarness.codex.add(skillName);
          }
          break;
        }
      }
    },
  });
  return { allowedEntries, skillDirsByHarness };
}

async function walkExtractedFiles(root: string, relDir = "", out: string[] = []): Promise<string[]> {
  const dir = relDir ? path.join(root, relDir) : root;
  const entries = await fs.promises.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const rel = relDir ? path.posix.join(relDir, entry.name) : entry.name;
    if (entry.isDirectory()) {
      await walkExtractedFiles(root, rel, out);
    } else if (entry.isFile()) {
      out.push(rel);
    }
  }
  return out;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function validateManifestSize(manifest: LatestSkillsManifest): void {
  if (!Number.isSafeInteger(manifest.size) || manifest.size <= 0) {
    throw new Error("Latest skills manifest has an invalid size");
  }
  if (manifest.size > MAX_SKILLS_TARBALL_BYTES) {
    throw new Error("Skills tarball is too large");
  }
}

function validateDownloadLength(response: Response, manifest: LatestSkillsManifest): void {
  const contentLength = response.headers.get("content-length");
  if (contentLength == null) return;
  const parsed = Number(contentLength);
  if (!Number.isSafeInteger(parsed) || parsed !== manifest.size) {
    throw new Error(`Tarball size mismatch: expected ${manifest.size}, got ${contentLength}`);
  }
}

function createExtractionLimiter() {
  let totalBytes = 0;
  let fileCount = 0;
  return (entry: unknown) => {
    const meta = entry as { type?: string; size?: number; path?: string };
    const type = meta.type;
    if (type && type !== "File" && type !== "OldFile" && type !== "ContiguousFile") return;
    fileCount++;
    if (fileCount > MAX_EXTRACTED_SKILL_FILES) {
      throw new Error("Skills tarball contains too many files");
    }
    const size = typeof meta.size === "number" ? meta.size : 0;
    if (size > MAX_EXTRACTED_SKILL_FILE_BYTES) {
      throw new Error(`Skills tarball entry is too large: ${meta.path ?? "unknown"}`);
    }
    totalBytes += size;
    if (totalBytes > MAX_EXTRACTED_SKILL_BYTES) {
      throw new Error("Skills tarball expands to too much data");
    }
  };
}
