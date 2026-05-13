import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";
import * as crypto from "node:crypto";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import * as tar from "tar";
import { getLicenseState } from "~/db/settings";
import { ACADEMY_BASE_URL, isAllowedAcademyDownloadUrl } from "~/shared/academy";
import { logger } from "~/shared/logger";

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

function readRequiredLicenseKey(): string {
  const key = getLicenseState().key?.trim();
  if (!key) {
    throw new Error("A valid license key is required to install skills.");
  }
  return key;
}

function licenseAuthHeaders(key: string): HeadersInit {
  return { authorization: `Bearer ${key}` };
}

function normalizeEntryPath(p: string): string | null {
  let s = p.replace(/\\/g, "/").replace(/^\.\//, "");
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

export async function fetchLatestSkillsManifest(): Promise<LatestSkillsManifest> {
  const licenseKey = readRequiredLicenseKey();
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

  const manifest = await fetchLatestSkillsManifest();
  if (!isAllowedAcademyDownloadUrl(manifest.downloadUrl)) {
    throw new Error(`Refusing to download from untrusted host: ${manifest.downloadUrl}`);
  }
  const licenseKey = readRequiredLicenseKey();

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
