#!/usr/bin/env node
// Publish a freshly-built mission-control release to the academy.
// Reads per-platform artifact dirs under ./artifacts/mc-<platform>/, calls
// the protected academy release API to register the version + get presigned
// upload URLs, uploads each binary to R2, then finalizes.

import { readFileSync, createReadStream, statSync, readdirSync } from "node:fs";
import { join, basename } from "node:path";

const {
  MISSION_CONTROL_RELEASE_TOKEN,
  ACADEMY_BASE_URL,
  RELEASE_VERSION,
  RELEASE_NOTES,
} = process.env;

function fail(msg) {
  console.error(`[publish-release] ${msg}`);
  process.exit(1);
}

if (!MISSION_CONTROL_RELEASE_TOKEN) fail("MISSION_CONTROL_RELEASE_TOKEN is required");
if (!ACADEMY_BASE_URL) fail("ACADEMY_BASE_URL is required");
if (!RELEASE_VERSION) fail("RELEASE_VERSION is required");

const baseUrl = ACADEMY_BASE_URL.replace(/\/$/, "");
const version = RELEASE_VERSION;
const notes = (RELEASE_NOTES ?? "").trim() || null;

const ARTIFACTS_DIR = "artifacts";
const PLATFORMS = ["mac-arm64", "mac-x64", "win-x64", "linux-x64"];

const assets = [];
for (const platform of PLATFORMS) {
  const dir = join(ARTIFACTS_DIR, `mc-${platform}`);
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
  } catch (err) {
    console.warn(`[publish-release] missing manifest for ${platform} (${err.message}); skipping`);
    continue;
  }
  // Sanity check: file referenced in manifest exists in the same dir.
  const filePath = join(dir, manifest.fileName);
  const stat = statSync(filePath);
  if (stat.size !== manifest.sizeBytes) {
    fail(
      `size mismatch for ${platform}: manifest says ${manifest.sizeBytes}, file is ${stat.size}`
    );
  }
  assets.push({ platform, dir, manifest, filePath });
}

if (assets.length === 0) fail("no artifacts found to publish");

console.log(
  `[publish-release] publishing ${version} with ${assets.length} asset(s):`
);
for (const a of assets) {
  console.log(`  - ${a.platform}: ${a.manifest.fileName} (${a.manifest.sizeBytes} bytes)`);
}

async function postJson(path, body) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${MISSION_CONTROL_RELEASE_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let parsed;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  if (!res.ok) {
    fail(`POST ${path} → ${res.status}: ${text}`);
  }
  return parsed;
}

const createBody = {
  version,
  notes,
  assets: assets.map((a) => ({
    platform: a.platform,
    fileName: a.manifest.fileName,
    contentType: a.manifest.contentType,
    sizeBytes: a.manifest.sizeBytes,
    sha256: a.manifest.sha256,
  })),
};

const created = await postJson(`/api/mission-control/releases`, createBody);
console.log(`[publish-release] created release id=${created.releaseId} channel=${created.channel}`);

// Upload each binary to its presigned URL.
for (const upload of created.uploads) {
  const asset = assets.find((a) => a.platform === upload.platform);
  if (!asset) fail(`server returned upload for unknown platform ${upload.platform}`);
  console.log(`[publish-release] uploading ${asset.manifest.fileName} → ${upload.objectKey}`);
  const stream = createReadStream(asset.filePath);
  const res = await fetch(upload.presignedUploadUrl, {
    method: "PUT",
    headers: {
      "Content-Type": asset.manifest.contentType,
      "Content-Length": String(asset.manifest.sizeBytes),
    },
    body: stream,
    duplex: "half",
  });
  if (!res.ok) {
    const text = await res.text();
    fail(`upload failed for ${asset.platform}: ${res.status} ${text}`);
  }
}

// Finalize.
const finalized = await postJson(
  `/api/mission-control/releases/${encodeURIComponent(version)}/finalize`,
  {}
);
console.log(`[publish-release] finalized:`, finalized);
