# Logger Bootstrap

Loaded only when SKILL.md Phase 2 detection finds **no** existing logger. If detection found one, do not load this file — conform to the existing API instead.

---

## Decision tree

```
Is this a Node/TS project that already has package.json?
├── YES → Is the project bundle-size-sensitive (browser, mobile, lambda cold start)?
│         ├── YES → Zero-dep fallback (Option A)
│         └── NO  → Offer pino (Option B); fall back to A on user decline
└── NO  → Zero-dep fallback (Option A) — works for bash hooks, scripts, anything
```

Always present both options to the user before committing.

---

## Option A — zero-dep fallback

Single file. Drop into the project's existing utility location (`src/lib/log.ts`, `app/utils/log.ts`, etc.). Match the surrounding code style (CommonJS vs ESM).

```ts
// src/lib/log.ts
type Level = "debug" | "info" | "warn" | "error";
const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const threshold: number =
  ORDER[(process.env.LOG_LEVEL as Level) ?? "info"] ?? ORDER.info;

function emit(level: Level, payload: Record<string, unknown>) {
  if (ORDER[level] < threshold) return;
  const line = JSON.stringify({ ts: new Date().toISOString(), level, ...payload });
  // stderr keeps logs out of stdout-as-data pipelines
  process.stderr.write(line + "\n");
}

export const log = {
  debug: (p: Record<string, unknown>) => emit("debug", p),
  info:  (p: Record<string, unknown>) => emit("info", p),
  warn:  (p: Record<string, unknown>) => emit("warn", p),
  error: (p: Record<string, unknown>) => emit("error", p),
};
```

Bash equivalent for hook scripts:

```bash
# place near top of any hook script
LOG_FILE="${LOG_FILE:-/tmp/$(basename "$0").log}"
log() {
  local level="$1"; shift
  printf '{"ts":"%s","level":"%s","msg":%s}\n' \
    "$(date -Iseconds)" "$level" "$(printf '%s' "$*" | jq -Rs .)" >> "$LOG_FILE"
}
# usage: log info "hook.fired"
```

---

## Option B — install pino

Smallest credible structured logger. ~30KB, fast, JSON output, level support.

```bash
# ask first — never run without user approval
npm install pino
```

```ts
// src/lib/log.ts
import pino from "pino";
export const log = pino({ level: process.env.LOG_LEVEL ?? "info" });
```

Pino's API (`log.info({event, ...})`) matches the recipes in `boundary-recipes.md` directly — no wrapper needed.

Decline pino if: project disallows new deps, project is browser-only (use `loglevel` instead, ask), or project is Electron-renderer-only (use `electron-log` instead, ask).

---

## After installing

1. Add `LOG_LEVEL` to `.env.example` if the project has one. Default to `info`; document that `debug` is verbose.
2. Verify the import path resolves: `tsc --noEmit` (or project equivalent).
3. Write down the import path and the runtime log destination (stderr / file / etc.) — Phase 5 needs both.
