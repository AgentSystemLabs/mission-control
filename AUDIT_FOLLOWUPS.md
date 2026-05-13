# Audit Follow-ups

Findings surfaced by the 2026-05-12 whole-repo audit that were **not** applied in the same pass. Each item requires either a product/design decision, a third-party dependency, or a refactor too large to bundle with the mechanical sweep.

Severity scale: **HIGH** (security or correctness), **MED** (perf / UX / DX), **LOW** (nit / hygiene).

---

## Security / abuse hardening

### HIGH — `parentDir` allowlist for `/api/launch-kit/projects`
- **Where:** `src/server/api-router.ts` (`POST /api/launch-kit/projects`) → `src/server/services/launch-kit.ts:114-190`
- **Gap:** endpoint accepts a renderer-supplied absolute `parentDir` and writes a tar payload anywhere the OS user can write. Token-gated, but a compromised renderer can wipe + replant any directory.
- **Blocker:** no OS-dialog-picked allowlist mechanism exists. `electron/main.ts:286` has `ALLOWED_PICKED_PATHS` for image picks — needs a sibling for folder picks, surfaced over IPC so the API can verify a token corresponds to a user-chosen folder.
- **TODO comment** is already in the route.

### HIGH — per-task scoped capability token for spawned shells
- **Where:** `electron/pty-manager.ts:285-289` (env injection), `electron/agent-hooks.ts:48-60` (curl Authorization header)
- **Gap:** every spawned agent shell receives the global `MC_API_TOKEN` in its env. Any process the agent runs (`npm install` post-install script, etc.) can exfiltrate it and gain full API authority.
- **Fix:** issue per-task short-lived HMACs (`HMAC(secret, taskId | expiry)`), validated only on `/api/hooks/:slug` and `/api/tasks/:id/status`. Shrinks blast radius if a child process steals the env.

### MED — rate limiting on sensitive endpoints
- **Where:** `src/server/api-router.ts` — `POST /api/license/validate`, `POST /api/settings { regenerate: true }`, `POST /api/hooks/:slug`
- **Gap:** no rate limit. Single-user localhost mitigates risk, but a renderer XSS / co-resident process has unlimited token-rotation and license-probe authority.
- **Blocker:** needs a token-bucket lib choice (eg. `@upstash/ratelimit` is overkill — in-memory `lru-cache` keyed by IP is plenty).

### MED — user-presence confirmation for token regeneration
- **Where:** `src/server/api-router.ts:346-352`
- **Gap:** `regenerate: true` rotates the API token with no second factor. A renderer XSS can rotate silently.
- **Fix:** require an Electron-native confirm dialog (`dialog.showMessageBox`) before honoring `regenerate`.

### LOW — logger redaction allowlist is small and case-sensitive
- **Where:** `electron/logger.ts:18`, mirror in `src/shared/logger.ts`
- **Gap:** `REDACT_KEYS = {"licenseKey","apiToken","token"}` only matches exact keys. Variants like `MC_API_TOKEN`, `authorization`, `bearer`, `password` pass through.
- **Fix:** case-insensitive regex `/(token|secret|password|authorization|bearer|api[_-]?key|license[_-]?key)/i` plus a value-level scrub for `Bearer <…>` substrings.

---

## Reliability

### MED — structured error reporter
- **Where:** entire app
- **Gap:** no Sentry/Bugsnag/Crashlytics in either main process or renderer. All `logger.warn`/`logger.error` calls land in stderr and a local file; unhandled error trends are invisible.
- **Blocker:** product decision — paid Sentry vs. self-hosted GlitchTip vs. accept the gap for a desktop app.

### MED — basic metrics (latency/failure) on hot IPC + API paths
- **Where:** `electron/pty-manager.ts`, `electron/file-handlers.ts`, `electron/install-skills.ts`, `src/server/api-router.ts`
- **Gap:** no metrics library installed. Hot ops (`pty.spawn`, `files.read`, `files.write`, `skills.install`) have no `duration_ms` capture.
- **Stopgap:** until a metrics lib lands, add `duration_ms` to the eventual success/error log line at each boundary.

### MED — `useGitStatus` polling errors surface nothing
- **Where:** `src/queries/git.ts:25-31`, `src/components/views/GitDiffView/*`
- **Gap:** 3-second poll. The route loader catches once, but ongoing 500s during polling produce no toast / no inline error. A broken git repo shows "0 unstaged" forever.
- **Fix:** read `error` in `CommitPushButton` / git status UI and render a small "git status unavailable" affordance.

### MED — PTY spawn failure only visible inside the terminal pane
- **Where:** `src/components/views/TerminalPane.tsx:282-284`, `UserTerminalPane.tsx:247-249`
- **Gap:** error rendered with `term.writeln(\x1b[31m…)` only inside the xterm surface. Collapsed pane → user never sees it. Task status stays `waiting`.
- **Fix:** set task to a failed state and surface a card-level error with retry; toast on first occurrence.

### LOW — `agent-hooks` install failure isn't user-visible
- **Where:** `electron/agent-hooks.ts:116-121` (now logs via `logger.warn` after the audit fixes — but still no user notification)
- **Gap:** PTY still spawns, agent runs with no hooks → "session finished" notifications never arrive, status updates never fire. User has no idea hooks didn't install.
- **Fix:** IPC a one-shot toast to the renderer on hook-install failure, or add a status badge to the session card.

---

## Performance

### MED — virtualize `DiffText`
- **Where:** `src/components/views/GitDiffView/DiffPane.tsx:58-93`
- **Gap:** renders one `<div>` per line up to 50,000 lines (`DIFF_MAX_LINES`). Clicking a large file freezes the view.
- **Fix:** `@tanstack/react-virtual` (already in the TanStack ecosystem) — rows are fixed-height, perfect fit. Alternatively lower the cap to ~5k and add a "show full diff" affordance.

### MED — token-usage daily rollup
- **Where:** `src/server/services/token-usage.ts:281-360`
- **Gap:** four full-table aggregate queries on every `/usage` open. Now indexed (`token_usage_project_ts_idx` from migration 0012), but still scans every row.
- **Fix:** maintain `token_usage_daily_rollup(day, projectId, totals…)` incrementally inside `doSync()`'s transaction. Turns three of the four queries into cheap lookups.

### MED — `tasks(projectId, status)` composite index
- **Where:** `src/server/services/projects.ts:212-219` (preview select) and `listTasksForProject`
- **Gap:** `WHERE projectId = ? AND archived = 0 AND status IN (…)` walks all of a project's tasks. Fine today, grows linearly.
- **Fix:** add `index('tasks_project_status_idx').on(projectId, status)` (and consider a partial index on `archived = 0`).

### MED — coalesce PTY chunks before IPC + DB write
- **Where:** `electron/pty-manager.ts:342-346` (`proc.onData`)
- **Gap:** node-pty can emit dozens of tiny chunks per second during fast output. Each pays structured-clone + DB write overhead. `appendTerminalLog` is now cached (audit pass), but IPC traffic is unchanged.
- **Fix:** tail-buffer chunks per `taskId` for ~16ms and flush — one IPC send + one DB row per frame.

### LOW — `getProjectPath` thundering-herd
- **Where:** `electron/main.ts:57-82`
- **Gap:** every IPC handler that needs a project path fetches in parallel on first project open; cache only populates after each resolves. Not a correctness bug — small startup waste.
- **Fix:** single-flight by `projectId` (`Map<projectId, Promise<string|null>>`), clear on resolve.

---

## Bundle / assets

### MED — `doors.png` (2.4MB) on first paint
- **Where:** `src/routes/__root.tsx:380, 383`
- **Fix:** convert to WebP/AVIF (likely <300KB); `loading="lazy"` on the second instance if it's offscreen at boot.

### MED — border-PNG set (~20MB) ships in asar
- **Where:** `public/borders/*` referenced from `src/lib/accent-colors.ts:58-70` and `src/components/views/ThemeSettingsPage.tsx:85-87`
- **Fix:** WebP/AVIF reduces by ~70%; downsample to ~256px if 9-slice borders are smaller than source.

### MED — lazy-load CodeMirror + xterm
- **Where:** `src/routes/__root.tsx:23-24` (via `TerminalPanel`/`UserTerminalPanel`), `src/routes/projects.$id.tsx:13` (via `FileEditorDialog`)
- **Gap:** five CodeMirror packages + xterm pull into the root chunk even when no terminal/editor is mounted.
- **Fix:** `const FileEditorDialog = React.lazy(() => import("~/components/views/FileEditorDialog"))` + Suspense; same for terminal panels if startup regresses.

### LOW — `public/_references/` (~4.8MB) ships unused
- **Where:** `public/_references/*` (design reference PNGs)
- **Fix:** move to `designs/` (outside `public/`) or add to electron-builder `files` exclusion.

### LOW — root-level stray files
- **Files:** `shift-enter-bug-notes.md`, `TERMINAL_FOCUS_BUG.md`, `TODO.md`
- **Fix:** move to `docs/notes/` or delete; not a build-time issue, just hygiene.

---

## Structure / DRY (larger refactors)

### MED — split `src/routes/projects.$id.tsx` (1298 lines)
- **Where:** the file; `ProjectPage` is ~1020 lines of it
- **Fix:** extract `<ProjectPageHeader>`, `<ProjectMenus>`, `useDuplicateSessionListener`, `useProjectHotkeys`. Move `RunStatusPill` (line ~1160) and `ProjectGitStatusButton` (line ~1118) to their own files.

### MED — `TerminalPane` + `UserTerminalPane` dedupe via `useXtermPty`
- **Where:** `src/components/views/TerminalPane.tsx` (427 lines) and `src/components/views/UserTerminalPane.tsx` (395 lines)
- **Gap:** ~70% duplicated xterm bootstrap, color-scheme watcher, FitAddon wiring, PTY lifecycle.
- **Fix:** extract `useXtermPty({ ptyId, onPtyReady, onExit, options })` hook + `<XtermSurface>` presentational component. Eliminates ~600 lines.

### MED — merge `terminal-store` + `user-terminal-store`
- **Where:** `src/lib/terminal-store.tsx` (315) and `src/lib/user-terminal-store.tsx` (429)
- **Gap:** parallel Provider/Ctx/active-map/localStorage/SSE wiring with ~70% structural overlap.
- **Fix:** generic `createPtyStore<T>({ storageKey, fetchFn, eventName })` or one store with a discriminator field.

### LOW — split other >400-line files
- `src/server/api-router.ts` (614) — group by resource into `src/server/routes/*`
- `src/components/views/GitDiffView/ChangedFilesList.tsx` (525)
- `src/routes/__root.tsx` (513)
- `src/server/services/git.ts` (463), `electron/main.ts` (454), `src/components/views/FileEditorDialog.tsx` (449), `electron/pty-manager.ts` (433), `src/components/views/NewAgentDialog.tsx` (431), `src/server/services/projects.ts` (425)

### LOW — `localStorage` key convention drift
- **Files:** mix of `mc.foo`, `mc:foo`, `mc-foo` (see `terminal-store.tsx:83`, `__root.tsx:113`, `SettingsPanel.tsx:37`, etc.)
- **Fix:** centralize in `src/lib/storage-keys.ts`; pick one separator.

### LOW — `server/services/groups.ts` color default
- **Where:** `src/server/services/groups.ts:37` still imports the `GROUP_COLORS` back-compat alias from `src/lib/design-meta.ts`.
- **Fix:** migrate the server reference to `BRAND_PALETTE` and remove the `GROUP_COLORS = BRAND_PALETTE` alias.

---

## Type safety (zod boundary expansion)

### MED — expand zod coverage to the remaining API routes
- **Where:** `src/server/api-router.ts` — `parseBody` helper + 4 routes already migrated. Remaining body-accepting routes still call `readJson<any>` and forward the whole body:
  - `POST /api/projects`, `PATCH /api/projects/:id`
  - `POST /api/groups`, `PATCH /api/groups/:id`
  - `PATCH /api/tasks/:id`, `POST /api/tasks/:id/status`
  - `POST /api/projects/:id/user-terminals`, `PATCH /api/user-terminals/:id`
  - `PUT /api/keybindings`
- **Fix:** define a zod schema per route, route through `parseBody`.

### MED — IPC payload validation
- **Where:** `electron/pty-manager.ts` (`IPC.ptySpawn` is the highest-value target), `electron/main.ts` shell handlers
- **Gap:** payloads are TypeScript-asserted only. A compromised renderer or future preload bug sees an unvalidated trust boundary.
- **Fix:** zod-validate at handler entry; `ptySpawn` opts first.

### MED — centralized env parsing
- **Where:** `src/server/services/license-crypto.ts:18`, `src/db/client.ts:19`, `electron/main.ts:16-19`, `electron/install-skills.ts:14-16`, `src/lib/api.ts:46`
- **Gap:** no `Number(port)` guard against NaN, no required-var assertion.
- **Fix:** single `src/shared/env.ts` validated at boot via zod.

### LOW — `JSON.parse(...) as T` audit
- **Where:** `src/lib/api.ts:90`, `src/db/settings.ts:84`, `src/db/keybindings.ts:29`, `electron/install-id.ts:17`, `electron/agent-hooks.ts:86`, `electron/pty-manager.ts:78`, `src/shared/domain.ts:128`, `src/server/services/license-crypto.ts:62`, `src/server/services/install-skills.ts:78`, `src/server/services/telemetry.ts:23`, `src/server/services/token-usage.ts:35`
- **Fix:** return `unknown`, validate at consumer with zod (or a typed guard for hot paths).

### LOW — `catch (e: any)` sweep in renderer + electron
- **Where:** `src/components/views/*.tsx` (numerous), `electron/file-handlers.ts:173,202`, `electron/pty-manager.ts:210,307`, `src/server/vite-api-plugin.ts:23`
- **Note:** server-side already migrated to `getErrorMessage(e: unknown)` from `src/server/lib/errors.ts`. Mirror that helper for renderer + electron and sweep call sites.

### LOW — CSS custom-prop typing
- **Where:** `src/components/ui/TopBar.tsx`, `HeaderActionsSlot.tsx`, `ShimmerBar.tsx`, `ProjectDialog.tsx`, `src/routes/__root.tsx:269,427,464,484,506`
- **Gap:** `as any` for `--mc-*` CSS vars and `WebkitAppRegion`.
- **Fix:** declare a typed helper `cssVar<K extends string>(k: K, v: string): React.CSSProperties` or extend `CSSProperties` in `src/types/css.d.ts`.

---

## Contracts

### LOW — `api.regenerateToken` return shape
- **Where:** `src/lib/api.ts:270-274` + `src/server/api-router.ts:351`
- **Status:** audit confirmed the only consumer (`ApiSettingsPage.tsx`) reads `r.apiToken` correctly. Leaving the `AppSettings & { apiToken: string }` type as-is is fine; revisit if a second consumer appears.

---

## Accessibility

### MED — whole-repo a11y pass
- **Status:** the diff-only `reviewer-accessibility-regression` couldn't operate (no diff). The full `/audit-a11y` was not run as part of this sweep.
- **Action:** run `/audit-a11y` separately for a whole-repo pass. Expect findings around dialog focus traps, icon-button accessible names, custom interactives, and form error→field association.
