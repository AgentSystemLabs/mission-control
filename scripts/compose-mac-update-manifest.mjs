#!/usr/bin/env node
import { createHash } from "node:crypto";
import {
  createReadStream,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

const {
  RELEASE_VERSION,
  RELEASE_MANIFESTS_DIR = "release-manifests",
  ARTIFACTS_DIR = "artifacts-mac-metadata",
} = process.env;

function fail(message) {
  console.error(`[compose-mac-update-manifest] ${message}`);
  process.exit(1);
}

if (!RELEASE_VERSION) fail("RELEASE_VERSION is required");

function digestFile(path, algorithm) {
  return new Promise((resolve, reject) => {
    const hash = createHash(algorithm);
    const stream = createReadStream(path);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

function collectManifestPaths(dir) {
  const paths = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      paths.push(...collectManifestPaths(fullPath));
    } else if (entry.isFile() && entry.name === "manifest.json") {
      paths.push(fullPath);
    }
  }
  return paths;
}

function yamlScalar(value) {
  return JSON.stringify(value);
}

const manifests = collectManifestPaths(RELEASE_MANIFESTS_DIR).map((path) =>
  JSON.parse(readFileSync(path, "utf8"))
);
const macZips = manifests
  .flatMap((manifest) => manifest.assets ?? [])
  .filter(
    (asset) =>
      typeof asset.platform === "string" &&
      asset.platform.startsWith("mac-") &&
      asset.kind === "installer-zip"
  )
  .sort((a, b) => {
    const rank = (asset) => (asset.platform === "mac-arm64" ? 0 : 1);
    return rank(a) - rank(b) || a.fileName.localeCompare(b.fileName);
  });

if (macZips.length === 0) {
  fail(`no mac installer-zip assets found under ${RELEASE_MANIFESTS_DIR}`);
}

const x64Zip = macZips.find((asset) => asset.platform === "mac-x64");
const fallbackZip = x64Zip ?? macZips[0];
const version = RELEASE_VERSION.replace(/^v/, "");
const releaseDate = new Date().toISOString();

const lines = [
  `version: ${yamlScalar(version)}`,
  "files:",
  ...macZips.flatMap((asset) => [
    `  - url: ${yamlScalar(asset.fileName)}`,
    `    sha512: ${yamlScalar(asset.sha512)}`,
    `    size: ${asset.sizeBytes}`,
  ]),
  `path: ${yamlScalar(fallbackZip.fileName)}`,
  `sha512: ${yamlScalar(fallbackZip.sha512)}`,
  `releaseDate: ${yamlScalar(releaseDate)}`,
  "",
];

rmSync(ARTIFACTS_DIR, { recursive: true, force: true });
mkdirSync(ARTIFACTS_DIR, { recursive: true });
const fileName = "latest-mac.yml";
const metadataPath = join(ARTIFACTS_DIR, fileName);
writeFileSync(metadataPath, lines.join("\n"));

const sizeBytes = statSync(metadataPath).size;
const metadataAsset = {
  platform: macZips.some((asset) => asset.platform === "mac-arm64")
    ? "mac-arm64"
    : macZips[0].platform,
  kind: "metadata",
  fileName,
  contentType: "application/x-yaml",
  sizeBytes,
  sha256: await digestFile(metadataPath, "sha256"),
};

writeFileSync(
  join(ARTIFACTS_DIR, "manifest.json"),
  JSON.stringify({ platform: metadataAsset.platform, assets: [metadataAsset] }, null, 2)
);

console.log(
  `[compose-mac-update-manifest] composed latest-mac.yml with ${macZips.length} zip entr${macZips.length === 1 ? "y" : "ies"}`
);
