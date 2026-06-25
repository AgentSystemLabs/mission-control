# Bundled whisper.cpp (voice control)

This directory holds the offline speech-to-text engine for push-to-talk voice
control. The artifacts are **not committed** (the model is ~148 MB) — they're
fetched/built locally and bundled into the packaged app via the
`extraResources` entry in `package.json`.

## Populate

```bash
pnpm setup:whisper
```

This produces:

- `whisper-server` — whisper.cpp's HTTP server binary (built from source with
  CMake; Metal GPU on macOS, plus CoreML *with allow-fallback* — it uses the
  CoreML encoder when `ggml-base.en-encoder.mlmodelc` is present and falls back to
  Metal when it isn't, instead of aborting). The setup script best-effort
  generates the CoreML model when python3 + coremltools + openai-whisper are
  installed; otherwise it's skipped and Metal is used.
- `ggml-base.en.bin` — the base English model.

Overrides if you already have these:

```bash
WHISPER_SERVER_BIN=/path/to/whisper-server WHISPER_MODEL=/path/to/ggml-base.en.bin pnpm setup:whisper
```

## Runtime behavior

`electron/whisper-server.ts` resolves the binary + model from here (in dev) or
from `process.resourcesPath/whisper/` (packaged), spawns the server lazily on
first use, and keeps it warm. If the artifacts are absent, voice transcription
reports unavailable instead of failing — so a build without them still runs.
