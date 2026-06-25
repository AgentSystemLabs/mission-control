#!/usr/bin/env node
// Vendors whisper.cpp's `whisper-server` binary, its shared libraries, and the
// base.en model into resources/whisper/ so the packaged app can transcribe voice
// commands offline.
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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const outDir = path.join(repoRoot, "resources", "whisper");
const isWindows = process.platform === "win32";
const isMac = process.platform === "darwin";
const binaryName = isWindows ? "whisper-server.exe" : "whisper-server";
const modelName = "ggml-base.en.bin";
const MODEL_URL = `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${modelName}`;
const WHISPER_REPO = "https://github.com/ggerganov/whisper.cpp";
const BUNDLE_RPATH = "@loader_path";
const MAC_SYSTEM_LIBRARY_PREFIXES = ["/usr/lib/", "/System/Library/"];
const commandAvailability = new Map();

function log(...args) {
  console.log("[fetch-whisper]", ...args);
}

function has(cmd) {
  if (commandAvailability.has(cmd)) return commandAvailability.get(cmd);
  try {
    execFileSync(isWindows ? "where" : "which", [cmd], { stdio: "ignore" });
    commandAvailability.set(cmd, true);
    return true;
  } catch {
    commandAvailability.set(cmd, false);
    return false;
  }
}

export function parseOtoolLibraries(output) {
  return output
    .split(/\r?\n/)
    .slice(1)
    .map((line) => line.trim().match(/^(.+?)\s+\(compatibility version/)?.[1])
    .filter(Boolean);
}

export function parseOtoolRpaths(output) {
  const lines = output.split(/\r?\n/);
  const rpaths = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i]?.trim() !== "cmd LC_RPATH") continue;
    for (let j = i + 1; j < Math.min(i + 6, lines.length); j += 1) {
      const match = lines[j]?.trim().match(/^path\s+(.+?)\s+\(offset\s+\d+\)$/);
      if (match?.[1]) {
        rpaths.push(match[1]);
        break;
      }
    }
  }
  return rpaths;
}

export function isMacBundledLibraryRef(ref) {
  if (!ref.endsWith(".dylib")) return false;
  if (MAC_SYSTEM_LIBRARY_PREFIXES.some((prefix) => ref.startsWith(prefix))) return false;
  return true;
}

export function inspectMacBundleLinkage(linkedLibraries, rpaths, availableFiles) {
  const bundledLibraryNames = Array.from(
    new Set(linkedLibraries.filter(isMacBundledLibraryRef).map((ref) => path.basename(ref))),
  );
  const missingLibraries = bundledLibraryNames.filter((name) => !availableFiles.has(name));
  const usesRpath = linkedLibraries.some((ref) => isMacBundledLibraryRef(ref) && ref.startsWith("@rpath/"));
  const hasBundleRpath = rpaths.includes(BUNDLE_RPATH) || rpaths.includes("@executable_path");

  return {
    bundledLibraryNames,
    missingLibraries,
    needsRpathRepair: usesRpath && !hasBundleRpath,
  };
}

function listMacLinkedLibraries(file) {
  if (!isMac || !has("otool")) return [];
  const output = execFileSync("otool", ["-L", file], { encoding: "utf8" });
  return parseOtoolLibraries(output);
}

function listMacRpaths(file) {
  if (!isMac || !has("otool")) return [];
  const output = execFileSync("otool", ["-l", file], { encoding: "utf8" });
  return parseOtoolRpaths(output);
}

function macBundleStatus(binaryPath, bundleDir) {
  if (!isMac || !has("otool")) {
    return { bundledLibraryNames: [], missingLibraries: [], needsRpathRepair: false };
  }
  const availableFiles = new Set(fs.existsSync(bundleDir) ? fs.readdirSync(bundleDir) : []);
  return inspectMacBundleLinkage(listMacLinkedLibraries(binaryPath), listMacRpaths(binaryPath), availableFiles);
}

function findFileByName(root, name) {
  if (!fs.existsSync(root)) return null;
  const pending = [root];
  while (pending.length > 0) {
    const current = pending.pop();
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isFile() && entry.name === name) return fullPath;
      if (entry.isDirectory()) pending.push(fullPath);
    }
  }
  return null;
}

function resolveMacLibrarySource(ref, loaderPath, searchDirs) {
  const refName = path.basename(ref);
  if (path.isAbsolute(ref) && fs.existsSync(ref)) return ref;

  const loaderDir = path.dirname(loaderPath);
  const relativeRef = ref
    .replace(/^@loader_path\//, "")
    .replace(/^@executable_path\//, "")
    .replace(/^@rpath\//, "");

  if ((ref.startsWith("@loader_path/") || ref.startsWith("@executable_path/")) && fs.existsSync(path.join(loaderDir, relativeRef))) {
    return path.join(loaderDir, relativeRef);
  }

  for (const dir of searchDirs) {
    const direct = path.join(dir, refName);
    if (fs.existsSync(direct)) return direct;
  }
  for (const dir of searchDirs) {
    const found = findFileByName(dir, refName);
    if (found) return found;
  }

  return null;
}

function rewriteMacRpath(file) {
  if (!isMac || !has("install_name_tool")) return;

  const linkedLibraries = listMacLinkedLibraries(file);
  const needsRpath = linkedLibraries.some((ref) => isMacBundledLibraryRef(ref) && ref.startsWith("@rpath/"));
  if (!needsRpath) return;

  const rpaths = listMacRpaths(file);
  if (rpaths.includes(BUNDLE_RPATH)) {
    for (const rpath of rpaths.filter((value) => value !== BUNDLE_RPATH)) {
      execFileSync("install_name_tool", ["-delete_rpath", rpath, file], { stdio: "ignore" });
    }
    return;
  }

  if (rpaths.length > 0) {
    execFileSync("install_name_tool", ["-rpath", rpaths[0], BUNDLE_RPATH, file], { stdio: "ignore" });
    for (const rpath of rpaths.slice(1)) {
      execFileSync("install_name_tool", ["-delete_rpath", rpath, file], { stdio: "ignore" });
    }
    return;
  }

  execFileSync("install_name_tool", ["-add_rpath", BUNDLE_RPATH, file], { stdio: "ignore" });
}

function vendorMacSharedLibraries(entryBinary, searchDirs, destDir) {
  if (!isMac) return;

  const allSearchDirs = Array.from(new Set([path.dirname(entryBinary), destDir, ...searchDirs]));
  const queued = [entryBinary];
  const processed = new Set();
  const linkedFiles = new Set([entryBinary]);

  while (queued.length > 0) {
    const current = queued.shift();
    const currentKey = path.resolve(current);
    if (processed.has(currentKey)) continue;
    processed.add(currentKey);

    const refs = listMacLinkedLibraries(current).filter((ref) => {
      if (!isMacBundledLibraryRef(ref)) return false;
      return path.basename(ref) !== path.basename(current);
    });

    for (const ref of refs) {
      const dest = path.join(destDir, path.basename(ref));
      if (!fs.existsSync(dest)) {
        const source = resolveMacLibrarySource(ref, current, allSearchDirs);
        if (!source) {
          throw new Error(`could not locate macOS shared library ${path.basename(ref)} required by ${current}`);
        }
        fs.copyFileSync(source, dest);
        fs.chmodSync(dest, 0o755);
        log(`bundled ${path.basename(ref)}`);
      }
      linkedFiles.add(dest);
      queued.push(dest);
    }
  }

  for (const file of linkedFiles) {
    rewriteMacRpath(file);
  }
}

function removeBundledMacDylibs() {
  if (!isMac || !fs.existsSync(outDir)) return;
  for (const file of fs.readdirSync(outDir)) {
    if (file.endsWith(".dylib")) fs.rmSync(path.join(outDir, file), { force: true });
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
    vendorMacSharedLibraries(dest, [path.dirname(process.env.WHISPER_SERVER_BIN)], outDir);
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
  const cmakeFlags = ["-B", "build", "-DCMAKE_BUILD_TYPE=Release", "-DBUILD_SHARED_LIBS=OFF"];
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
  vendorMacSharedLibraries(dest, [path.dirname(built), path.join(buildRoot, "build")], outDir);
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

  if (fs.existsSync(binDest)) {
    const status = macBundleStatus(binDest, outDir);
    if (status.missingLibraries.length > 0) {
      log(`existing binary is missing bundled dylibs (${status.missingLibraries.join(", ")}) — rebuilding`);
      fs.rmSync(binDest, { force: true });
      removeBundledMacDylibs();
      buildBinary(binDest);
    } else {
      log("binary already present — verifying");
      vendorMacSharedLibraries(binDest, [outDir], outDir);
    }
  } else {
    removeBundledMacDylibs();
    buildBinary(binDest);
  }

  const finalStatus = macBundleStatus(binDest, outDir);
  if (finalStatus.missingLibraries.length > 0 || finalStatus.needsRpathRepair) {
    throw new Error(
      `whisper-server macOS linkage is incomplete: missing=${finalStatus.missingLibraries.join(",") || "none"} ` +
        `needsRpathRepair=${finalStatus.needsRpathRepair}`,
    );
  }

  log(`done. resources/whisper/ is ready (${binaryName} + ${modelName}).`);
}

if (path.resolve(process.argv[1] ?? "") === __filename) {
  main().catch((err) => {
    console.error("[fetch-whisper] failed:", err.message);
    process.exit(1);
  });
}
