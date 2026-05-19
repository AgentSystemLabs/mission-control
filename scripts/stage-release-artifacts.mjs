#!/usr/bin/env node
import { createHash } from "node:crypto";
import {
  copyFileSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
  createReadStream,
} from "node:fs";
import { basename, join } from "node:path";

const {
  RELEASE_PLATFORM: platform,
  RELEASE_ARTIFACT_EXT: artifactExt,
  OUT_DIR = "dist-electron-out",
  ARTIFACTS_DIR = "artifacts",
} = process.env;

function fail(message) {
  console.error(`[stage-release-artifacts] ${message}`);
  process.exit(1);
}

if (!platform) fail("RELEASE_PLATFORM is required");
if (!artifactExt) fail("RELEASE_ARTIFACT_EXT is required");

function digestFile(path, algorithm) {
  return new Promise((resolve, reject) => {
    const hash = createHash(algorithm);
    const stream = createReadStream(path);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

function contentTypeFor(fileName) {
  if (fileName.endsWith(".dmg")) return "application/x-apple-diskimage";
  if (fileName.endsWith(".exe")) return "application/vnd.microsoft.portable-executable";
  if (fileName.endsWith(".AppImage")) return "application/x-executable";
  if (fileName.endsWith(".zip")) return "application/zip";
  if (fileName.endsWith(".yml")) return "application/x-yaml";
  return "application/octet-stream";
}

function isInstaller(fileName) {
  return fileName.endsWith(`.${artifactExt}`) && !fileName.endsWith(".blockmap");
}

function classify(fileName) {
  if (isInstaller(fileName)) return "installer";
  if (platform.startsWith("mac-") && fileName.endsWith(".zip")) {
    return "installer-zip";
  }
  if (fileName.endsWith(".blockmap")) {
    if (platform.startsWith("mac-")) {
      return fileName.endsWith(".zip.blockmap") ? "blockmap" : null;
    }
    return "blockmap";
  }
  if (platform === "win-x64" && fileName === "latest.yml") return "metadata";
  if (platform === "linux-x64" && fileName === "latest-linux.yml") return "metadata";
  // macOS latest-mac.yml is composed once in finalize from both arch zip entries.
  return null;
}

const outputFiles = readdirSync(OUT_DIR).filter((fileName) => {
  const path = join(OUT_DIR, fileName);
  return statSync(path).isFile();
});

const staged = [];
rmSync(ARTIFACTS_DIR, { recursive: true, force: true });
mkdirSync(ARTIFACTS_DIR, { recursive: true });

for (const fileName of outputFiles) {
  const kind = classify(fileName);
  if (!kind) continue;

  const src = join(OUT_DIR, fileName);
  const destName = basename(fileName);
  const dest = join(ARTIFACTS_DIR, destName);
  copyFileSync(src, dest);
  const sizeBytes = statSync(dest).size;
  staged.push({
    platform,
    kind,
    fileName: destName,
    contentType: contentTypeFor(destName),
    sizeBytes,
    sha256: await digestFile(dest, "sha256"),
    sha512: await digestFile(dest, "sha512"),
  });
}

const kinds = new Set(staged.map((asset) => asset.kind));
const requiredKinds = platform.startsWith("mac-")
  ? ["installer", "installer-zip", "blockmap"]
  : platform === "win-x64"
    ? ["installer", "metadata", "blockmap"]
    : ["installer", "metadata"];
const missing = requiredKinds.filter((kind) => !kinds.has(kind));
if (missing.length > 0) {
  fail(
    `missing required artifact kind(s) for ${platform}: ${missing.join(", ")}; output files: ${outputFiles.join(", ")}`
  );
}

writeFileSync(
  join(ARTIFACTS_DIR, "manifest.json"),
  JSON.stringify({ platform, assets: staged }, null, 2)
);

for (const asset of staged) {
  console.log(
    `[stage-release-artifacts] ${platform}/${asset.kind}: ${asset.fileName} (${asset.sizeBytes} bytes, sha256=${asset.sha256})`
  );
}
