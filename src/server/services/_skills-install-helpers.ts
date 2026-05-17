import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

export function licenseAuthHeaders(key: string): HeadersInit {
  return { authorization: `Bearer ${key}` };
}

// Strip leading "./", reject absolute paths, traversal segments, and NULs.
// Used to safely filter entries from untrusted .tar.gz downloads before
// extraction.
export function normalizeEntryPath(p: string): string | null {
  const s = p.replace(/\\/g, "/").replace(/^\.\//, "");
  if (!s || s.startsWith("/") || s.includes("\0")) return null;
  if (s.split("/").some((part) => part === "..")) return null;
  return s;
}

export function assertSafeProjectRelativePath(
  projectRoot: string,
  relPath: string,
  label: string,
): void {
  const norm = normalizeEntryPath(relPath);
  if (!norm) throw new Error(`${label} path is invalid`);

  const root = path.resolve(projectRoot);
  let cursor = root;
  const parts = norm.split("/").filter(Boolean);
  for (let i = 0; i < parts.length; i++) {
    cursor = path.join(cursor, parts[i]!);
    const relative = path.relative(root, cursor);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error(`${label} target escapes the project root`);
    }

    const stat = fs.lstatSync(cursor, { throwIfNoEntry: false });
    if (!stat) break;
    if (stat.isSymbolicLink()) {
      throw new Error(`${label} target crosses a symlink inside the project`);
    }
    if (i < parts.length - 1 && !stat.isDirectory()) {
      throw new Error(`${label} parent path is not a directory`);
    }
  }
}

// Stream the response body into `tempFile` while hashing it. Throws if the
// fetch fails, the body is missing, or the resulting sha256 doesn't match.
// `kind` is used only in the error message (e.g., "skills", "Launch Kit").
export async function downloadAndVerifyTarball(opts: {
  url: string;
  headers: HeadersInit;
  tempFile: string;
  expectedSha256: string;
  kind: string;
}): Promise<void> {
  const { url, headers, tempFile, expectedSha256, kind } = opts;
  const dlRes = await fetch(url, { headers });
  if (!dlRes.ok || !dlRes.body) {
    throw new Error(
      `Failed to download ${kind}: ${dlRes.status} ${dlRes.statusText}`,
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
  if (got.toLowerCase() !== expectedSha256.toLowerCase()) {
    throw new Error(
      `${kind} sha256 mismatch: expected ${expectedSha256}, got ${got}`,
    );
  }
}
