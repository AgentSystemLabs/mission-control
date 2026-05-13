import { app } from "electron";
import * as path from "node:path";
import * as fs from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import * as tar from "tar";
import * as crypto from "node:crypto";
import { logger } from "./logger";

// Pinned contracts. Renderer reads VITE_ACADEMY_BASE_URL via import.meta.env.
// Main process resolves at runtime; default to prod.
// TODO: confirm final prod URL with operations.
export const DEFAULT_ACADEMY_BASE_URL =
  process.env.VITE_ACADEMY_BASE_URL ??
  process.env.ACADEMY_BASE_URL ??
  (process.env.NODE_ENV === "development"
    ? "http://localhost:3000"
    : "https://academy.agentsystemlabs.com");

export type LatestSkillsManifest = {
  version: string;
  downloadUrl: string;
  sha256: string;
  size: number;
};

export type InstallSkillsArgs = {
  projectPath: string;
  harnesses: { claude: boolean; codex: boolean };
  licenseKey?: string;
};

export type InstallSkillsResult = {
  version: string;
  claudeInstalled: boolean;
  codexInstalled: boolean;
  skillCount: number;
};

const ALLOWED_PREFIXES = [".claude/skills/", ".codex/skills/"] as const;

function normalizeEntryPath(p: string): string | null {
  // Strip any leading "./" and convert backslashes
  let s = p.replace(/\\/g, "/").replace(/^\.\//, "");
  // Strip leading slashes (absolute paths not allowed)
  if (s.startsWith("/")) return null;
  // Reject path traversal
  const parts = s.split("/");
  if (parts.some((part) => part === "..")) return null;
  return s;
}

function entryAllowed(
  normPath: string,
  harnesses: { claude: boolean; codex: boolean },
): boolean {
  if (normPath.startsWith(".claude/skills/")) return harnesses.claude;
  if (normPath.startsWith(".codex/skills/")) return harnesses.codex;
  return false;
}

function allowedDownloadHost(downloadUrl: string): boolean {
  try {
    const u = new URL(downloadUrl);
    if (u.protocol !== "https:" && u.protocol !== "http:") return false;
    const base = new URL(DEFAULT_ACADEMY_BASE_URL);
    if (u.hostname === base.hostname) return true;
    // Allow subdomains of the apex (e.g. cdn.agentsystemlabs.com when
    // academy is academy.agentsystemlabs.com).
    const parts = base.hostname.split(".");
    if (parts.length >= 2) {
      const apex = parts.slice(-2).join(".");
      if (u.hostname === apex) return true;
      if (u.hostname.endsWith(`.${apex}`)) return true;
    }
    // Localhost for dev.
    if (
      process.env.NODE_ENV === "development" &&
      (u.hostname === "localhost" || u.hostname === "127.0.0.1")
    ) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

export async function fetchLatestSkillsManifest(
  licenseKey?: string,
): Promise<LatestSkillsManifest> {
  const key = licenseKey?.trim();
  if (!key) {
    throw new Error("A valid license key is required to install skills.");
  }

  const url = `${DEFAULT_ACADEMY_BASE_URL.replace(/\/$/, "")}/api/skills/latest`;
  const res = await fetch(url, {
    headers: { authorization: `Bearer ${key}` },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    logger.warn("skills manifest fetch failed", {
      op: "skills.manifest.fetch",
      status: res.status,
      statusText: res.statusText,
      body,
    });
    throw new Error(`Failed to fetch latest skills manifest: ${res.status} ${res.statusText}`);
  }
  const json = (await res.json()) as Partial<LatestSkillsManifest>;
  if (
    typeof json.version !== "string" ||
    typeof json.downloadUrl !== "string" ||
    typeof json.sha256 !== "string" ||
    typeof json.size !== "number"
  ) {
    throw new Error("Latest skills manifest is malformed");
  }
  return json as LatestSkillsManifest;
}

export async function installSkills(args: InstallSkillsArgs): Promise<InstallSkillsResult> {
  const t0 = Date.now();
  const { projectPath, harnesses } = args;
  logger.info("installSkills starting", {
    op: "skills.install",
    projectPath,
    harnesses,
  });
  const licenseKey = args.licenseKey?.trim();
  if (!licenseKey) {
    throw new Error("A valid license key is required to install skills.");
  }

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

  const manifest = await fetchLatestSkillsManifest(licenseKey);
  if (!allowedDownloadHost(manifest.downloadUrl)) {
    throw new Error(`Refusing to download from untrusted host: ${manifest.downloadUrl}`);
  }

  // Download tarball to temp file
  const tempDir = app.getPath("temp");
  const tempFile = path.join(
    tempDir,
    `mc-skills-${manifest.version}-${crypto.randomBytes(6).toString("hex")}.tar.gz`,
  );

  try {
    const dlRes = await fetch(manifest.downloadUrl, {
      headers: { authorization: `Bearer ${licenseKey}` },
    });
    if (!dlRes.ok || !dlRes.body) {
      throw new Error(
        `Failed to download skills tarball: ${dlRes.status} ${dlRes.statusText}`,
      );
    }
    const hash = crypto.createHash("sha256");
    const fileStream = fs.createWriteStream(tempFile);
    const nodeStream = Readable.fromWeb(dlRes.body as unknown as import("stream/web").ReadableStream);
    nodeStream.on("data", (chunk: Buffer | string) => {
      hash.update(chunk);
    });
    await pipeline(nodeStream, fileStream);
    const got = hash.digest("hex");
    if (got.toLowerCase() !== manifest.sha256.toLowerCase()) {
      throw new Error(
        `Tarball sha256 mismatch: expected ${manifest.sha256}, got ${got}`,
      );
    }

    // Pass 1: enumerate top-level skill dirs the tarball ships under each harness.
    const skillDirsByHarness = {
      claude: new Set<string>(),
      codex: new Set<string>(),
    };
    const allowedEntries = new Set<string>();
    await tar.list({
      file: tempFile,
      onentry: (entry) => {
        // Reject anything that isn't a regular file or directory.
        // Symlinks, hardlinks, devices, etc. could escape projectPath.
        const t = (entry as unknown as { type?: string }).type;
        if (t && t !== "File" && t !== "Directory" && t !== "OldFile" && t !== "ContiguousFile") return;
        const norm = normalizeEntryPath(entry.path as unknown as string);
        if (!norm) return;
        if (!entryAllowed(norm, harnesses)) return;
        allowedEntries.add(norm);
        // Capture top-level skill dir name: ".claude/skills/<skill>/..."
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

    // Per-skill clean overwrite: rm -rf each shipped skill dir inside projectPath.
    for (const skill of skillDirsByHarness.claude) {
      const target = path.join(projectPath, ".claude", "skills", skill);
      await fs.promises.rm(target, { recursive: true, force: true });
    }
    for (const skill of skillDirsByHarness.codex) {
      const target = path.join(projectPath, ".codex", "skills", skill);
      await fs.promises.rm(target, { recursive: true, force: true });
    }

    // Pass 2: extract only the allowed entries.
    await tar.extract({
      file: tempFile,
      cwd: projectPath,
      filter: (filePath) => {
        const norm = normalizeEntryPath(filePath);
        if (!norm) return false;
        return allowedEntries.has(norm);
      },
    });

    let skillCount = 0;
    if (harnesses.claude) skillCount += skillDirsByHarness.claude.size;
    if (harnesses.codex) skillCount += skillDirsByHarness.codex.size;

    const result = {
      version: manifest.version,
      claudeInstalled: harnesses.claude && skillDirsByHarness.claude.size > 0,
      codexInstalled: harnesses.codex && skillDirsByHarness.codex.size > 0,
      skillCount,
    };
    logger.info("installSkills complete", {
      op: "skills.install",
      version: manifest.version,
      durationMs: Date.now() - t0,
    });
    return result;
  } finally {
    await fs.promises.rm(tempFile, { force: true }).catch((err) => {
      logger.warn("failed to clean temp tarball", { err, tempFile });
    });
  }
}
