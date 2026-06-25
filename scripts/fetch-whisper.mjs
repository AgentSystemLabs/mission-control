#!/usr/bin/env node
// Vendors whisper.cpp's `whisper-server` binary + the base.en model into
// resources/whisper/ so the packaged app can transcribe voice commands offline.
// These artifacts are git-ignored (the model is ~148 MB); run this once after a
// fresh clone and before `pnpm package`.
//
//   node scripts/fetch-whisper.mjs
//
// Overrides (skip the build/download for an artifact you already have):
//   WHISPER_SERVER_BIN=/path/to/whisper-server   reuse an existing binary
//   WHISPER_MODEL=/path/to/ggml-base.en.bin       reuse an existing model
//
// The binary is built from source with CMake (Metal/CoreML enabled on macOS for
// the fastest inference). Requires `git` and `cmake` on PATH for the build path.

import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const outDir = path.join(repoRoot, "resources", "whisper");
const isWindows = process.platform === "win32";
const binaryName = isWindows ? "whisper-server.exe" : "whisper-server";
const modelName = "ggml-base.en.bin";
const MODEL_URL = `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${modelName}`;
const WHISPER_REPO = "https://github.com/ggerganov/whisper.cpp";

function log(...args) {
  console.log("[fetch-whisper]", ...args);
}

function has(cmd) {
  try {
    execFileSync(isWindows ? "where" : "which", [cmd], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

async function downloadModel(dest) {
  if (process.env.WHISPER_MODEL && fs.existsSync(process.env.WHISPER_MODEL)) {
    log("copying model from WHISPER_MODEL");
    fs.copyFileSync(process.env.WHISPER_MODEL, dest);
    return;
  }
  log(`downloading ${modelName} (~148 MB)…`);
  const res = await fetch(MODEL_URL, { redirect: "follow" });
  if (!res.ok) throw new Error(`model download failed: ${res.status} ${res.statusText}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(dest, buf);
  log(`model saved (${(buf.length / 1e6).toFixed(0)} MB)`);
}

function buildBinary(dest) {
  if (process.env.WHISPER_SERVER_BIN && fs.existsSync(process.env.WHISPER_SERVER_BIN)) {
    log("copying binary from WHISPER_SERVER_BIN");
    fs.copyFileSync(process.env.WHISPER_SERVER_BIN, dest);
    fs.chmodSync(dest, 0o755);
    return;
  }
  if (!has("git") || !has("cmake")) {
    throw new Error(
      "git and cmake are required to build whisper-server. Install them, or set " +
        "WHISPER_SERVER_BIN to a prebuilt binary.",
    );
  }
  const buildRoot = fs.mkdtempSync(path.join(os.tmpdir(), "whisper-build-"));
  log("cloning whisper.cpp…");
  execFileSync("git", ["clone", "--depth", "1", WHISPER_REPO, buildRoot], { stdio: "inherit" });

  // Metal GPU acceleration is on by default on macOS. On macOS we also enable
  // CoreML for the fastest encoder — but WITH allow-fallback, so if the .mlmodelc
  // encoder model isn't present the binary logs a warning and falls back to Metal
  // instead of aborting at startup. (Without fallback it SIGABRTs on a missing
  // CoreML model.)
  const cmakeFlags = ["-B", "build", "-DCMAKE_BUILD_TYPE=Release"];
  if (process.platform === "darwin") {
    cmakeFlags.push("-DWHISPER_COREML=1", "-DWHISPER_COREML_ALLOW_FALLBACK=1");
  }
  log("configuring…");
  execFileSync("cmake", cmakeFlags, { cwd: buildRoot, stdio: "inherit" });
  log("building whisper-server…");
  execFileSync("cmake", ["--build", "build", "--config", "Release", "-j", "--target", "whisper-server"], {
    cwd: buildRoot,
    stdio: "inherit",
  });

  const candidates = [
    path.join(buildRoot, "build", "bin", binaryName),
    path.join(buildRoot, "build", "bin", "Release", binaryName),
  ];
  const built = candidates.find((c) => fs.existsSync(c));
  if (!built) throw new Error(`could not locate built whisper-server (looked in: ${candidates.join(", ")})`);
  fs.copyFileSync(built, dest);
  fs.chmodSync(dest, 0o755);
  log("binary built");

  // Best-effort: generate the CoreML encoder so CoreML is actually used. Needs
  // python3 + coremltools + openai-whisper. If unavailable, skip — the allow-
  // fallback binary still works on Metal.
  maybeGenerateCoreMlModel(buildRoot);
}

function maybeGenerateCoreMlModel(buildRoot) {
  if (process.platform !== "darwin") return;
  const dest = path.join(outDir, "ggml-base.en-encoder.mlmodelc");
  if (fs.existsSync(dest)) {
    log("CoreML encoder model already present — skipping");
    return;
  }
  try {
    execFileSync("python3", ["-c", "import coremltools, whisper, ane_transformers"], {
      stdio: "ignore",
    });
  } catch {
    log(
      "CoreML model not generated (python3 + coremltools + openai-whisper + ane_transformers " +
        "not available). The binary will fall back to Metal — voice still works.",
    );
    return;
  }
  try {
    log("generating CoreML encoder model (base.en) — this can take a few minutes…");
    execFileSync("bash", [path.join(buildRoot, "models", "generate-coreml-model.sh"), "base.en"], {
      cwd: buildRoot,
      stdio: "inherit",
    });
    const generated = path.join(buildRoot, "models", "ggml-base.en-encoder.mlmodelc");
    if (fs.existsSync(generated)) {
      fs.cpSync(generated, dest, { recursive: true });
      log("CoreML encoder model installed");
    } else {
      log("CoreML generation finished but model not found — using Metal fallback.");
    }
  } catch (err) {
    log(`CoreML model generation failed (${err.message}) — using Metal fallback.`);
  }
}

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  const modelDest = path.join(outDir, modelName);
  const binDest = path.join(outDir, binaryName);

  if (fs.existsSync(modelDest)) log("model already present — skipping");
  else await downloadModel(modelDest);

  if (fs.existsSync(binDest)) log("binary already present — skipping");
  else buildBinary(binDest);

  log(`done. resources/whisper/ is ready (${binaryName} + ${modelName}).`);
}

main().catch((err) => {
  console.error("[fetch-whisper] failed:", err.message);
  process.exit(1);
});
