#!/usr/bin/env node
import { makeFail } from "./lib/cli.mjs";
// Per-platform mission-control publish helper.
//
// Subcommands:
//   prepare   Create-or-get the release row on academy for $RELEASE_VERSION.
//             Idempotent — safe to call from every platform job.
//   publish   Read ./artifacts/manifest.json (built by the current job),
//             register each asset on the release, and upload it to R2.
//   finalize  Verify all expected platforms are uploaded and mark the
//             release finalized (Unlocks Approve on agentsystem.dev). Called
//             from release.yml finalize-academy after all platforms succeed.
//             Approval (not finalize) is what advances the Electron updater.
//
// Why split: previously this script demanded all 4 platform manifests up front
// and called one combined create-with-assets endpoint. That coupled every
// platform's success/failure into one publish step. Now each matrix job runs
// `prepare` (idempotent) + `publish` for its own platform, so a single failed
// platform no longer blocks siblings.

import { readFileSync, createReadStream, statSync } from "node:fs";
import { join } from "node:path";

const {
  MISSION_CONTROL_RELEASE_TOKEN,
  ACADEMY_BASE_URL,
  RELEASE_VERSION,
  RELEASE_NOTES,
  RELEASE_EXPECTED_PLATFORMS,
  ARTIFACTS_DIR = "artifacts",
} = process.env;

const fail = makeFail("publish-release");

if (!MISSION_CONTROL_RELEASE_TOKEN)
  fail("MISSION_CONTROL_RELEASE_TOKEN is required");
if (!ACADEMY_BASE_URL) fail("ACADEMY_BASE_URL is required");
if (!RELEASE_VERSION) fail("RELEASE_VERSION is required");

const baseUrl = ACADEMY_BASE_URL.replace(/\/$/, "");
const version = RELEASE_VERSION;
const subcommand = process.argv[2];

async function apiCall(method, path, body) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${MISSION_CONTROL_RELEASE_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed = text;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    /* leave as text */
  }
  if (!res.ok) {
    fail(`${method} ${path} → ${res.status}: ${text}`);
  }
  return parsed;
}

async function prepare() {
  const notes = (RELEASE_NOTES ?? "").trim() || null;
  const expectedPlatforms = RELEASE_EXPECTED_PLATFORMS
    ? RELEASE_EXPECTED_PLATFORMS.split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : undefined;
  const result = await apiCall("POST", "/api/mission-control/releases", {
    version,
    notes,
    expectedPlatforms,
  });
  console.log(
    `[publish-release] prepared id=${result.releaseId} channel=${result.channel} alreadyExisted=${result.alreadyExisted}`
  );
}

async function publish() {
  const manifestPath = join(ARTIFACTS_DIR, "manifest.json");
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (err) {
    fail(`failed to read ${manifestPath}: ${err.message}`);
  }
  const assets = Array.isArray(manifest.assets) ? manifest.assets : [manifest];
  if (assets.length === 0) {
    fail(`manifest contains no assets: ${JSON.stringify(manifest)}`);
  }

  for (const asset of assets) {
    const { platform, kind, fileName, contentType, sizeBytes, sha256 } = asset;
    if (!platform || !fileName || !contentType || !sizeBytes || !sha256) {
      fail(`manifest asset missing required fields: ${JSON.stringify(asset)}`);
    }
    const filePath = join(ARTIFACTS_DIR, fileName);
    const stat = statSync(filePath);
    if (stat.size !== sizeBytes) {
      fail(`${fileName} size mismatch: manifest=${sizeBytes} actual=${stat.size}`);
    }

    const body = { platform, fileName, contentType, sizeBytes, sha256 };
    if (kind) body.kind = kind;

    const result = await apiCall(
      "POST",
      `/api/mission-control/releases/${encodeURIComponent(version)}/assets`,
      body
    );
    console.log(
      `[publish-release] registered ${platform}/${result.kind} → ${result.objectKey}; uploading...`
    );
    const uploadRes = await fetch(result.presignedUploadUrl, {
      method: "PUT",
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(sizeBytes),
      },
      body: createReadStream(filePath),
      duplex: "half",
    });
    if (!uploadRes.ok) {
      const text = await uploadRes.text();
      fail(
        `upload failed for ${platform}/${kind ?? "installer"} ${fileName}: ${uploadRes.status} ${text}`
      );
    }
    console.log(`[publish-release] uploaded ${fileName} (${sizeBytes} bytes)`);
  }
}

async function finalize() {
  const result = await apiCall(
    "POST",
    `/api/mission-control/releases/${encodeURIComponent(version)}/finalize`,
    {}
  );
  console.log(`[publish-release] finalized:`, result);
}

switch (subcommand) {
  case "prepare":
    await prepare();
    break;
  case "publish":
    await publish();
    break;
  case "finalize":
    await finalize();
    break;
  default:
    fail(
      `unknown subcommand "${subcommand ?? ""}"; expected one of: prepare, publish, finalize`
    );
}
