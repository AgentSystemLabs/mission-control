// Local, offline speech-to-text for voice control. We run whisper.cpp's
// `whisper-server` as a long-lived child process and keep it warm: the model is
// loaded once (lazily, on first use) and reused for every subsequent utterance,
// so a short push-to-talk clip transcribes in a few hundred ms instead of
// paying the model-load cost each time. Nothing leaves the machine.
//
// The binary + base.en model are bundled under resources/whisper/ (see
// scripts/fetch-whisper.mjs and the electron-builder `extraResources` entry).
// If they're missing — e.g. on a platform we don't ship them for — transcription
// reports unavailable rather than crashing.

import { spawn, type ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import * as net from "node:net";
import * as path from "node:path";
import { app } from "electron";
import log from "electron-log/main";

const BINARY_NAME = process.platform === "win32" ? "whisper-server.exe" : "whisper-server";
const MODEL_NAME = "ggml-base.en.bin";
const STARTUP_TIMEOUT_MS = 20_000;
const POLL_INTERVAL_MS = 150;

export class WhisperUnavailableError extends Error {
  constructor() {
    super("Voice transcription is unavailable: the whisper model is not installed.");
    this.name = "WhisperUnavailableError";
  }
}

function resourceCandidates(rel: string): string[] {
  const appPath = app.getAppPath();
  const candidates = [
    process.resourcesPath ? path.join(process.resourcesPath, "whisper", rel) : null,
    path.join(appPath, "resources", "whisper", rel),
    path.join(appPath, "..", "resources", "whisper", rel),
    path.join(__dirname, "..", "..", "resources", "whisper", rel),
  ];
  return candidates.filter((c): c is string => !!c);
}

function resolveResource(rel: string): string | null {
  for (const candidate of resourceCandidates(rel)) {
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch {
      /* unreadable candidate — keep looking */
    }
  }
  return null;
}

export function resolveWhisperBinary(): string | null {
  return resolveResource(BINARY_NAME);
}

export function resolveWhisperModel(): string | null {
  return resolveResource(MODEL_NAME);
}

export function isWhisperAvailable(): boolean {
  return !!resolveWhisperBinary() && !!resolveWhisperModel();
}

type RunningServer = { proc: ChildProcess; port: number };
// A single in-flight/resolved init promise, assigned synchronously, so concurrent
// transcribe calls share ONE whisper-server process instead of racing to spawn.
let serverPromise: Promise<RunningServer> | null = null;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function pickFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      srv.close(() => (port ? resolve(port) : reject(new Error("could not allocate a port"))));
    });
  });
}

// The server has no /health endpoint; "listening" = the port accepts a request.
// Any HTTP response (even 404) means it's up. We bail early if the child exits.
async function waitForListening(port: number, proc: ChildProcess): Promise<void> {
  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (proc.exitCode !== null || proc.signalCode !== null) {
      throw new Error("whisper-server exited during startup");
    }
    try {
      const res = await fetch(`http://127.0.0.1:${port}/`, { method: "GET" });
      await res.text().catch(() => undefined);
      return;
    } catch {
      await delay(POLL_INTERVAL_MS);
    }
  }
  throw new Error("whisper-server did not start listening in time");
}

async function ensureServer(): Promise<RunningServer> {
  if (serverPromise) return serverPromise;
  // Assign synchronously before the first await so a second caller reuses it.
  serverPromise = (async (): Promise<RunningServer> => {
    const binary = resolveWhisperBinary();
    const model = resolveWhisperModel();
    if (!binary || !model) throw new WhisperUnavailableError();

    const port = await pickFreePort();
    const proc = spawn(
      binary,
      ["-m", model, "--host", "127.0.0.1", "--port", String(port), "-l", "en", "-nt"],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    // stderr can carry decoded speech; keep it at debug so transcript content
    // isn't persisted to the default on-disk log for an offline feature.
    proc.stderr?.on("data", (chunk: Buffer) => {
      log.debug("whisper.stderr", chunk.toString().trim());
    });
    proc.on("error", (err) => {
      log.error("whisper.spawn-error", err);
    });
    proc.on("exit", (code, signal) => {
      log.warn("whisper.exit", { code, signal });
      // Drop the cache when the live process dies so the next call respawns.
      if (serverPromise) {
        void serverPromise
          .then((s) => {
            if (s.proc === proc) serverPromise = null;
          })
          .catch(() => {
            serverPromise = null;
          });
      }
    });

    try {
      await waitForListening(port, proc);
    } catch (err) {
      try {
        proc.kill();
      } catch {
        /* already gone */
      }
      throw err;
    }
    log.info("whisper.ready", { port });
    return { proc, port };
  })().catch((err) => {
    // Never cache a failed startup — the next call should retry cleanly.
    serverPromise = null;
    throw err;
  });
  return serverPromise;
}

/**
 * Load the model ahead of the first real command so push-to-talk feels instant.
 * Safe to call repeatedly; swallows errors (it's an optimization, not a gate).
 */
export async function prewarmWhisper(): Promise<void> {
  if (!isWhisperAvailable()) return;
  try {
    await ensureServer();
  } catch (err) {
    log.warn("whisper.prewarm-failed", err);
  }
}

/**
 * Transcribe a 16 kHz mono 16-bit WAV buffer. Returns the trimmed transcript.
 * `prompt` is whisper's initial_prompt — used to bias the decoder toward expected
 * words (e.g. the user's project names) so homophones resolve correctly.
 */
export async function transcribeWav(wav: Buffer, prompt?: string): Promise<string> {
  const { port } = await ensureServer();
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(wav)], { type: "audio/wav" }), "audio.wav");
  form.append("response_format", "json");
  form.append("temperature", "0");
  if (prompt && prompt.trim()) {
    form.append("prompt", prompt.trim());
    form.append("carry_initial_prompt", "true");
  }

  const res = await fetch(`http://127.0.0.1:${port}/inference`, { method: "POST", body: form });
  if (!res.ok) {
    throw new Error(`whisper inference failed with status ${res.status}`);
  }
  const data = (await res.json()) as { text?: unknown };
  return typeof data.text === "string" ? data.text.trim() : "";
}

export function shutdownWhisper(): void {
  const current = serverPromise;
  serverPromise = null;
  if (!current) return;
  void current
    .then((s) => {
      try {
        s.proc.kill();
      } catch {
        /* already gone */
      }
    })
    .catch(() => undefined);
}
