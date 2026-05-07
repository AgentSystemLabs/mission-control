import * as fs from "node:fs";
import * as path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { extract as tarExtract } from "tar";
import { resolveSkillsDir } from "~/db/client";
import {
  getLicenseState,
  getSkillsInitializedAt,
  setSkillsInitializedAt,
} from "~/db/settings";
import { ACADEMY_BASE_URL } from "~/shared/academy";
import { isProTier } from "~/shared/license";

export class SkillsBundleError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "not_pro"
      | "no_key"
      | "network"
      | "academy_rejected"
      | "extract_failed",
  ) {
    super(message);
    this.name = "SkillsBundleError";
  }
}

export type SkillsInitResult = {
  initializedAt: string;
  fileCount: number;
};

export type SkillsStatus = {
  initializedAt: string | null;
  dir: string;
};

export function readSkillsStatus(): SkillsStatus {
  return {
    initializedAt: getSkillsInitializedAt(),
    dir: resolveSkillsDir(),
  };
}

/**
 * Download the academy skills tarball using the stored Pro license key,
 * wipe-and-extract into the user-data skills directory, and persist the
 * timestamp. Idempotent — re-running overwrites the previous extraction.
 */
export async function initializeSkills(): Promise<SkillsInitResult> {
  const stored = getLicenseState();
  if (!stored.key) {
    throw new SkillsBundleError("No license key on file.", "no_key");
  }
  const proState = {
    hasKey: !!stored.key,
    status: stored.status,
    graceUntil: stored.graceUntil,
  };
  if (!isProTier(proState)) {
    throw new SkillsBundleError(
      "Mission Control Pro is required to download the skills bundle.",
      "not_pro",
    );
  }

  let res: Response;
  try {
    res = await fetch(`${ACADEMY_BASE_URL}/api/licenses/skills-bundle`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ key: stored.key }),
    });
  } catch (e: any) {
    throw new SkillsBundleError(
      `Couldn't reach the skills server: ${e?.message ?? "network error"}`,
      "network",
    );
  }

  if (!res.ok || !res.body) {
    throw new SkillsBundleError(
      `Skills server rejected the request (HTTP ${res.status}).`,
      "academy_rejected",
    );
  }

  const dir = resolveSkillsDir();
  // Clean slate: wipe + recreate. Failure mid-extract leaves the dir empty,
  // which is the correct "not initialized" state — next attempt re-runs.
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });

  try {
    // node fetch returns a web ReadableStream; convert to a node stream and
    // pipe into tar's extract (which itself unzips gzip via { gzip: true } /
    // auto-detect — tar v7 auto-detects gzip).
    const nodeStream = Readable.fromWeb(res.body as any);
    // strict + preservePaths:false → reject absolute paths, ".." traversal,
    // and malformed entries. The academy is a trusted source, but defense in
    // depth: never write outside `dir`.
    await pipeline(
      nodeStream,
      tarExtract({ cwd: dir, strict: true, preservePaths: false }),
    );
  } catch (e: any) {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    throw new SkillsBundleError(
      `Failed to extract skills bundle: ${e?.message ?? "extract error"}`,
      "extract_failed",
    );
  }

  const initializedAt = new Date().toISOString();
  setSkillsInitializedAt(initializedAt);

  return { initializedAt, fileCount: countFiles(dir) };
}

function countFiles(dir: string): number {
  let n = 0;
  const stack: string[] = [dir];
  while (stack.length) {
    const cur = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(cur, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const full = path.join(cur, e.name);
      if (e.isDirectory()) stack.push(full);
      else if (e.isFile()) n++;
    }
  }
  return n;
}
