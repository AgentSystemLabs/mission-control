# Low-Risk Refactor & Cleanup Plan

> Generated from a 5-agent parallel scan of the codebase (2026-06-06). Each finding was
> verified against working-tree source with precise `file:line` references. Scope was
> split into: **server** (`src/server/`), **frontend lib/state** (`src/lib/`),
> **React UI** (`src/components/`, `src/routes/`), **electron + agent** (`electron/`,
> `mc-agent/src/`), and **shared/db/scripts/queries**.
>
> Everything here is **behavior-preserving** (LOW risk). Items flagged ⚠️ need a quick
> confirmation before touching because they hint at a latent inconsistency.

---

## How to use this document

- Work **top-down by phase**. Phase 1 (quick wins) is mechanical and safe to batch.
- Each item has an **effort** estimate: **S** (<30 min), **M** (~1–3 h), **L** (half-day+).
- Cross-cutting items (Phase 0) touch multiple slices and have the highest leverage —
  do these first so single-slice items can build on the new shared helpers.
- After each phase, run the test suite (`npm test` / vitest) — the repo has good test
  coverage in `__tests__/` dirs across every slice.

---

## Phase 0 — Cross-cutting consolidations (highest leverage)

These appeared in **multiple** independent slice scans. Fixing them once removes drift
risk across the whole app.

### 0.1 — Unify scope-id normalization & the `"local"` literal ⚠️
**Effort: S–M.** `LOCAL_SCOPE_ID` / scope-key logic is re-implemented in 6+ places.
- `normalizeScopeId` duplicated: `src/server/repositories/tasks.repo.ts:11-13`,
  `src/server/repositories/user-terminals.repo.ts:7-9`,
  `src/server/services/home-terminals.ts:16`, inline in `src/server/services/sandbox-scope.ts:21`.
- `scopeKeyForProject` byte-identical in `src/lib/terminal-store.tsx:120-122` and
  `src/lib/user-terminal-store.tsx:107-109`.
- Raw `"local"` literal where `LOCAL_SCOPE_ID` is already imported:
  `src/db/schema.ts:231` (`.default("local")`), and a redundant private
  `const LOCAL_SCOPE = "local"` in `src/db/migrate-multi-sandbox.ts:14`.
- **Fix:** export one `normalizeScopeId` and one `scopeKeyForProject` from a shared
  module (next to `LOCAL_SCOPE_ID` in `~/shared/sandbox`); replace all literals/copies.
- ⚠️ Confirm the raw-SQL `'local'` literals in `src/db/client.ts` (lines 381, 427, 442,
  521, 524, 527) are intentionally inlined (they can't import TS) — add a tracking comment.

### 0.2 — Share git-clone redaction & SSH-remote validation across processes
**Effort: M. Security-sensitive — these MUST stay in sync.**
- `scrubCloneError` byte-identical: `electron/sandbox-manager.ts:96-117` and
  `mc-agent/src/git-rpc.ts:72-100`.
- `redactRemote`/`redactCloneRemote` near-identical: same two files.
- SSH regex set (`SSH_USER`, `SSH_HOST`, `SSH_REPO_PATH`, `SSH_SCP_REMOTE` incl. the
  fragile `.source.slice(1,-1)` trick): `electron/sandbox-manager.ts:40-45` and
  `mc-agent/src/git-rpc.ts:23-28`.
- `isSafeSshCloneRemote` (sandbox-manager:119) vs `validateCloneRemote` (git-rpc:104):
  same allow-list, different throw-vs-bool shape.
- Clone-env literals `GIT_ALLOW_PROTOCOL="http:https:ssh"` and
  `GIT_SSH_COMMAND="ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new"`:
  `mc-agent/src/git-rpc.ts:256-259` and `electron/sandbox-manager.ts:749-755`.
- `MAX_CRED_BYTES = 256 * 1024` defined twice: `electron/sandbox-manager.ts:852`,
  `mc-agent/src/creds-rpc.ts:17`.
- **Fix:** extract `src/shared/git-remote-redact.ts` (redaction + SSH regexes +
  `isSafeSshCloneRemote` + clone-env constants + `MAX_CRED_BYTES`); import from both
  processes. Keep `validateCloneRemote` as a thin throwing wrapper.

### 0.3 — Single source for `MAX_TCP_PORT` / `65535`
**Effort: S.** Defined as a const in `scripts/dev-local.mjs:8` and
`src/shared/mission-control-hook-env.ts:6`; named in `src/server/services/sandboxes.ts:51`;
but re-appears as a bare `65535` in `src/server/controllers/sandboxes.controller.ts:82`
and `scripts/predev.mjs:40,76`.
- **Fix:** one shared `MAX_TCP_PORT`; replace all bare literals.

### 0.4 — Shared `safeJsonParse<T>(raw, fallback)` helper
**Effort: S.** Try/catch-around-`JSON.parse` reimplemented many times:
`src/server/services/sandboxes.ts:54-60` (`parseJson`), `src/server/services/sandbox-scope.ts:7-14`,
`src/server/controllers/settings.controller.ts:102-106`, plus ~11 service files that
`JSON.parse` inline.
- **Fix:** promote one `safeJsonParse<T>` to a shared module; migrate call sites.

### 0.5 — Shared date helpers (`toMillis`, `toIso`)
**Effort: S.** Byte-identical date coercion copied across hosted services:
- `toMillis`: `src/server/services/hosted-projects.ts:110-114`,
  `hosted-groups.ts:31-35`, `hosted-user-terminals.ts:37-41`.
- `toIso`/`iso`: `src/server/services/entitlements.ts:14-17`,
  `hosted-runtime-usage.ts:21-24`, `src/server/controllers/support.controller.ts:110-113`.
- **Fix:** one `src/server/services/hosted-date.ts` (or existing date util) with both.

### 0.6 — Shared `shortId(prefix)` + `errMsg(err)` helpers
**Effort: S.**
- Four hand-rolled id generators with differing radix/slice:
  `electron/main.ts:428`, `:432`, `:1096`, `electron/pty-manager.ts:523`.
- Inline `err instanceof Error ? err.message : String(err)` repeated:
  `mc-agent/src/server.ts:137,144,186,197` (sandbox-manager already has `describe()` at :694).
- **Fix:** a shared `shortId(prefix)` and an `errMsg(err)` helper (mc-agent `logger.ts`).

---

## Phase 1 — Quick wins (mechanical, batchable, S effort)

### Server
1. **`getHostedContext(request)` copied verbatim in 4 controllers** —
   `projects.controller.ts:67-71`, `tasks.controller.ts:64-68`, `groups.controller.ts:27-31`,
   `user-terminals.controller.ts:36-40`. Export one from `controllers/_helpers.ts`.
2. **`urlWorktreeId` / `urlScopeId` identical in two controllers** —
   `tasks.controller.ts:118-126` and `user-terminals.controller.ts:98-106` (also
   `git.controller.ts:34-37`). Move to `_helpers.ts`.
3. **Route raw `new Response(JSON.stringify({error}))` through existing `jsonError`** —
   `projects.controller.ts:93-96`, `sandboxes.controller.ts:93-97`, `auth.ts:148-151`
   (`_helpers.ts` already exports `jsonError`/`json`/`notFound`).
4. **Name rate-limit / clock-skew / diagnostics-limit magic numbers** —
   `RATE_LIMIT_WINDOW_MS = 60_000` (`services/rate-limits.ts:58,66,74,82`),
   `CLOCK_SKEW_TOLERANCE_MS = 60_000` (`support.controller.ts:118`, `academy-auth.ts:224,253`),
   `DIAGNOSTICS_ROW_LIMIT = 20` (`support.controller.ts:211,220,228,237`).
5. **Delete dead alias `isTitlePromptEvent`** (`hooks.controller.ts:48-50`) — call
   `isSessionCaptureEvent` directly (only caller at :164).
6. **Remove redundant wrapper `captureSessionFromHook`** (`hooks.controller.ts:78-87`) —
   only re-does the empty-id guard `reconcileSessionId` already performs at :59.

### Frontend lib
7. **Use `DEFAULT_PTY_COLS` / `DEFAULT_PTY_ROWS` instead of `cols:100, rows:30`** —
   `session-warm-pool.ts:189-190`, `user-terminal-warm-pool.ts:115` (constants already
   exported from `src/shared/pty-size.ts:5-6`; the `normalizePtySize` call on the defaults
   is a no-op — also compute it once, not once per dimension).
8. **Use `DEFAULT_TASK_STATUS` instead of hardcoded `"ready"`** —
   `session-warm-pool.ts:76` (`optimistic-task.ts:43` already does this).
9. **Hoist `user-terminal-store` localStorage keys to named consts** —
   `user-terminal-store.tsx:140,149,160,169` repeat `"mc.userTerminalHiddenIds"` /
   `"mc.userTerminalPanelOpen"` (sibling stores already hoist their keys; read/write
   drift risk).
10. **De-dupe `discardWarmSlotQuiet` vs `discardWarmSlot`** — the quiet variant differs
    by one line (no `warmGeneration += 1`): `session-warm-pool.ts:110-129`,
    `user-terminal-warm-pool.ts:48-67`. Have one call the other.
11. **Name `SANDBOX_POLL_INTERVAL_MS = 500`** — `project-sandbox-create.ts:73,122,130`
    (file already names its timeouts).
12. **Export one `ScopedProject` type** instead of re-declaring it 4× —
    `terminal-store.tsx:28-31`, `user-terminal-store.tsx:32-35`,
    `session-warm-pool.ts:16`, `user-terminal-warm-pool.ts:9`.

### React UI
13. **Delete dead `AgentSystemBanner` + its dead state/effect/import** —
    `__root.tsx:737-855` (~119 lines, zero usages), plus `bannerDismissed`/effect
    (`:260-266`), and the now-unused `Icon` import (`:16`). Highest-confidence deletion.
14. **Export & reuse `SETTINGS_PANEL_IDS`** — duplicated in 4 places (one has a
    "Keep in sync" comment): `SettingsPanel.tsx:18-40`, `__root.tsx:53-63`,
    `settings.tsx:8-18`. Derive the type and the zod enum from one const.
15. **Introduce `Z_INDEX = { modal: 9999, popover: 10000 }` token** — `zIndex: 10000`
    repeated in 5 portal/dropdown files: `projects.$id.tsx:1934`, `ProjectBar.tsx:602`,
    `ProjectCard.tsx:251`, `BranchTypeahead.tsx:307`, `GitDiffView/ChangedFilesList.tsx:359`.
16. **`openExternal(url)` helper** — `window.open(url,"_blank","noopener,noreferrer")`
    repeated ~9× and **inconsistent** (2 sites drop `noopener`): `__root.tsx:704`,
    `index.tsx:584`, `plans.tsx:83`, `projects.$id.tsx:2002`, `AuthGate.tsx:200`,
    `UpdateAvailableButton.tsx:80,109`, `AgentUpdateRequiredDialog.tsx:40`,
    `CreatePullRequestButton.tsx:31`.
17. **Reuse `showProjectContent`** instead of re-spelling the load/error guard —
    `index.tsx:194-198` defines it; `:377` and `:440` re-write it longhand.

### Electron + agent
18. **Delete dead passthrough `ensureAgentCredsProvisionedFor`** —
    `sandbox-manager.ts:712-717` just forwards to `provisionAgentCredsFor`; callers at
    :476, :1149 can call it directly.
19. **Name remaining magic numbers** — `REMOTE_PTY_REPLAY_TIMEOUT_MS = 5_000`
    (`sandbox-manager.ts:1207`), `STDERR_TAIL_LOG_CHARS = 2000` (`:319,409`),
    `MIN_REDACTABLE_TOKEN_LEN = 8` (`:91`), `TERMINAL_IMAGE_NAME_MAX_LEN = 80`
    (`main.ts:1046`), remote-vm sentinel prefixes (`main.ts:391,394,797,800`).
20. **`remoteVmSpawnEnv()` helper** — `{...sanitizedProcessEnv(), ELECTRON_RUN_AS_NODE:"1",
    MC_USER_DATA_DIR}` literal repeated at `main.ts:581-585,692-696,739-743,779-783`.
21. **`withOwnerClient(ptyId, fn)` helper** — `remotePtyWrite/Resize/Kill` share the same
    owner-routing preamble: `sandbox-manager.ts:1176-1194`.

### Shared / scripts
22. **Stop hardcoding `pnpm@11.1.2`** (5+ spots: `dev-local.mjs:53,101,136`,
    `remote-vm.mjs:507`) — read from `package.json#packageManager` (already done in
    `ensure-*-sqlite.mjs:7`).
23. **`scripts/lib/cli.mjs` with `makeFail(prefix)`** — `fail(msg)` copy-pasted in
    `publish-release.mjs:31`, `release-local.mjs:35`, `stage-release-artifacts.mjs:21`,
    `compose-mac-update-manifest.mjs:20`.
24. **`scripts/lib/hash.mjs` with `digestFile`** — byte-identical in
    `stage-release-artifacts.mjs:29-37` and `compose-mac-update-manifest.mjs:27-35`.
25. **Shared `MISSIONCONTROL_DB_FILENAME`** — `"missioncontrol.db"` in `db/client.ts:37`
    and `remote-vm.mjs:1104`.

---

## Phase 2 — Medium consolidations (M effort)

### Server
26. **`withDomainErrors(fn, fallback?)` wrapper** — the
    `try {...} catch(e){ const m = handleDomainError(e); if(m) return m; throw e; }`
    block recurs ~30×: projects/tasks/user-terminals/groups/home-terminals/hooks
    controllers (Duplicate #2), plus the git/worktrees variant with a custom fallback
    (`git.controller.ts` 9 sites, `worktrees.controller.ts` 3 sites — Duplicate #3).
    A single wrapper with an optional `fallback(e)` covers both. **Highest-value server item.**
27. **Shared `CapExceededError` base + `capExceededResponse(e)`** — the 402 payload
    `{error,code,limit,current}` is built identically in `projects.controller.ts:103-113`
    and `sandboxes.controller.ts:114-124`; the two error classes (`services/projects.ts:27-37`,
    `services/sandboxes.ts:29-39`) share the shape.
28. **`findAccountLink(pool, lookup)`** — identical 10-col SELECT in `support.controller.ts`
    `183-191` and `316-325`; `adjustEntitlement` even rebuilds a fake `URL` to reuse a
    lookup (`:308-314`) — add `lookupFromParts(...)`.
29. **Table-drive `settings.controller.ts` `update`** — `:148-235` is a 90-line ladder of
    `if (body.x !== undefined) setSetting(...)` in two fixed shapes (bool / nullable-string).
    Drive from a `{field → {key, kind}}` table. ⚠️ verify each key string maps exactly.
30. **Project `update`/`getOne` togglePin+patch logic written twice (hosted vs local)** —
    `projects.controller.ts:165-205`. Extract the decision once, then dispatch.

### Frontend lib
31. **Shared `local-storage-json.ts` (`readJson`/`writeJson`)** — the SSR-guard +
    try/catch JSON localStorage pattern is hand-rolled ~8×: `terminal-store.tsx:128-151,232-240`,
    `user-terminal-store.tsx:137-176`, `git-diff-view-store.ts:19-36`,
    `ui-preference-cache.ts:55-77`, `session-notification-store.ts:144-169`.
32. **`buildDraftTask` should delegate to `buildOptimisticTask`** — both build a full Task
    row with the same constant fields: `session-warm-pool.ts:61-89` vs `optimistic-task.ts:23-54`
    (diverge only in `status` + skip-permissions gating).
33. **Shared `killPty(id)` / `writePty(id,data)` transport-resolver** — the
    `isRemotePtyId ? electron.* : api.*` branching repeats: `terminal-store.tsx:296-305,603-608`,
    `user-terminal-store.tsx:504-509`.
34. **`pruneBuckets(keys)` local helper** — `closeForProject` (`user-terminal-store.tsx:530-557`)
    and `closeHomeForScope` (`:570-593`) repeat the same delete-keys updater across 4 setters.

### React UI
35. **Extract a `<StatusNotice>` / `<InlineBanner>` primitive** — the
    `role="status"` mono notice box is repeated 3× (2 byte-for-byte):
    `projects.$id.tsx:2135-2153`, `:2155-2173`, `index.tsx:551-568`.
36. **Extract `<RemoveProjectConfirmDialog>`** — identical ConfirmDialog (same copy)
    in `index.tsx:508-526` and `projects.$id.tsx:2558-2573`.
37. **Extract a `<CodeBox>` / `<MonoPathBox>`** — mono path/code box style repeated in
    `projects.$id.tsx:2451-2465`, `:2647-2661`, `:2436-2450`.
38. **Normalize `catch (e: any)` → `unknown` + `getErrorMessage(e)`** —
    `projects.$id.tsx:925,1003,1564,1582,1598` use `any`; siblings use `unknown`+
    `instanceof Error`. Preserve `ApiError` narrowing (`:1010` reads `e?.status===409`).

### Electron + agent
39. **`runRemoteVmCli(args, opts)` + `lastNonEmptyLine(output, fallback)`** — three
    near-identical spawn-collect-parse functions: `destroyRemoteVm` (`main.ts:673-717`),
    `runRemoteVmLifecycle` (`:719-764`), `runRemoteVmReconcile` (`:766-824`). **~100 lines.**
40. **Generic `subscribe<T>(channel, cb)` in preload** — the 4-line on/removeListener
    block repeats ~14×: `preload.ts:253-265,298-307,319-345,354-361,428-441,491-504,508-523,532-536,606-610`.
41. **Split `registerSandboxManager` along its comment groups** — `sandbox-manager.ts:992-1276`
    (280 lines) → `registerSandboxLifecycleHandlers` / `...RemotePtyHandlers` / etc.
42. **Extract `classifyDeployExit(...)` from `startRemoteVmDeployJob`** —
    `main.ts:557-643` (the `child.on("exit")` classifier at `:601-640` is a clean unit);
    optionally split `buildRemoteVmDeployArgs` per-provider (`main.ts:329-385`).

### Shared / scripts
43. **Extract `scripts/lib/dev-port.mjs` + `scripts/lib/dotenv.mjs`** — ~120 lines of
    port/process-detection + dotenv helpers duplicated between `predev.mjs:92-211` and
    `dev-local.mjs:215-334` (`release-local.mjs:41-57` reimplements dotenv a 3rd time).
44. **Extract `scripts/lib/better-sqlite.mjs`** — load/rebuild plumbing + inline smoke-test
    snippet duplicated across `ensure-node-sqlite.mjs` and `ensure-electron-sqlite.mjs`.
45. **One exported `MC_AGENT_ENV_KEYS` array** — `MC_TASK_ID`/`MC_API_URL`/`MC_API_TOKEN`
    appear as bare strings in the generated plugin source
    (`src/shared/opencode-mission-control-plugin.ts:33-35,64-66`); interpolate from one list.

---

## Phase 3 — Larger structural extractions (L effort, gate per-item)

46. **Unify the two warm-pool modules** — `src/lib/session-warm-pool.ts` and
    `src/lib/user-terminal-warm-pool.ts` share the entire single-slot pool machinery
    (state, `discard*`, `peek*`, `take*`, generation-guarded prepare, `replenish*`);
    only the spawn payload differs. Extract a generic
    `createWarmPool<TSlot>({ signatureOf, spawn, kill })`; both become thin configs.
    **~130 lines collapse.** (Builds on Phase 1 items #7, #8, #10, #12.)

47. **Carve up `src/routes/projects.$id.tsx` (3336 lines)** into focused components —
    independent, each LOW risk (move JSX + props):
    - `ProjectActionsMenu` (`:1915-2105`, ~190 lines, portal menu).
    - `DeleteWorktreeDialog` (`:2575-2762`, ~187 lines).
    - `ProjectPathIssueDialog` (`:2370-2497`).
    - `ProjectHeaderActions` (`:1739-1828`).

48. **Unify the persisted sandbox schema between app & remote-vm script** ⚠️ —
    `resolveUserDataDir` (`db/client.ts:20-27` vs `remote-vm.mjs:141-145`), `ensureColumn`/
    `quoteIdent` (`db/client.ts:128-141` vs `remote-vm.mjs:1076-1084`), and the `sandboxes`
    CREATE TABLE DDL + column list (`db/client.ts:318-336,502-517` vs
    `remote-vm.mjs:1033-1051,1058-1073`, byte-for-byte). Two copies of persisted schema is a
    real correctness hazard. `.mjs`↔`.ts` boundary makes full unification awkward — at
    minimum make the column list a single exported array both consume.

49. **Shared `<SegmentedControl>` primitive** — three radiogroup implementations with an
    inline `segment()` style factory: `SessionScopeToggle` (`projects.$id.tsx:2847-2866`),
    `ProjectsDashboardViewToggle`, `WorktreeToggleGroup`. ⚠️ verify visual parity.

---

## Items to confirm before touching (possible latent bugs, not just smells)

- ⚠️ **Pinned-slot count mismatch** — the matcher accepts slots `1..9`
  (`src/lib/keybindings/match.ts:39-48`) but the UI label hardcodes `"1–4"`
  (`src/lib/keybindings/format.ts:37-41`). Decide the intended count, then drive both
  from one `PINNED_SLOT_COUNT` constant. *Confirm intent first — could be a real gap.*
- ⚠️ **`RemoteVmDeployInput` type drift** — `electron/main.ts:175-223` vs the
  `RemoteVmDeployInputBridge` in `preload.ts:84-131`: main's aws variant has
  `imageStrategy` (`main.ts:198`) the bridge omits. Process isolation is deliberate, but
  align the shapes (or document the omission).
- ⚠️ **`filterProjectsByScope` is an identity no-op** —
  `src/shared/sandbox.ts:147-154` ignores its `sandboxState` arg; `useScopedProjects`
  (`src/queries/index.ts:177-185`) builds a `useMemo` purely to call the passthrough. If
  scope-filtering is abandoned, drop both; if it's a future hook, leave a TODO.
- ⚠️ **Deprecated re-exports** — `AGENT_CLI_VERSION_REQUIREMENTS[_BY_COMMAND]` marked
  `@deprecated` in `src/shared/agent-cli-config.ts:110-114`. `grep -r` for importers;
  delete if none.

---

## Suggested execution order (TL;DR)

1. **Phase 0** (0.1–0.6) — shared helpers first; everything else leans on them.
2. **Phase 1** — batch the quick wins; #13 (delete dead banner) and #5/#6 (dead
   server code) are the safest, highest-confidence starting points.
3. **Phase 2** — #26 (`withDomainErrors`), #31 (localStorage JSON), #39 (`runRemoteVmCli`),
   #43 (`scripts/lib/`) are the biggest line-count reductions.
4. **Phase 3** — gate each per-item; #46 (warm-pool) and #47 (split `projects.$id.tsx`).
5. Resolve the ⚠️ "confirm first" list as discovered.

Run the relevant `__tests__/` suite after each phase. None of these change behavior, so
green tests = safe to land.

---

## Execution log (2026-06-06)

> Worked top-down. Note: this ran concurrently with a separate **hosted/daytona removal**
> refactor that deleted `mc-agent/`, hosted services, and `support`/`academy`/`launch-kit`
> controllers. That made several items **obsolete** (their targets were deleted). The tree
> was transiently red during the overlap but is now **fully green** (`tsc` 0 errors, vitest
> 924 passing). Gate: full `tsc --noEmit` + `tsc -p electron/tsconfig.json` + `vitest run`.

**Phase 0 — done.** New shared modules: `src/shared/{tcp-port,safe-json,short-id,err-msg}.ts`,
`src/lib/scoped-project.ts`.
- 0.1 ✅ `normalizeScopeId` → `~/shared/sandbox`; `scopeKeyForProject`+`ScopedProject` → `~/lib/scoped-project` (also resolves item #12); `"local"` literals in schema/migrate/client now use `LOCAL_SCOPE_ID`.
- 0.2 ⊘ OBSOLETE — redaction/clone-env duplication eliminated by `mc-agent` deletion (single in-repo consumer left).
- 0.3 ✅ `MAX_TCP_PORT` shared; electron + server + UI consume it; scripts keep a mirrored named const.
- 0.4 ✅ `safeJsonParse<T>` shared; migrated sandboxes/sandbox-scope/settings.controller/settings/keybindings.
- 0.5 ⊘ OBSOLETE — all hosted-* date-helper targets deleted.
- 0.6 ✅ `shortId`/`errMsg` shared; applied to electron main/pty-manager/session-finish (sandbox-manager keeps its equivalent `describe`).

**Phase 1 — done** (item 1 ⊘ obsolete: `getHostedContext` removed by hosted-removal).
- Server 2–6 ✅ (`urlWorktreeId`/`urlScopeId` → `_helpers`; raw error Responses → `jsonError`; `RATE_LIMIT_WINDOW_MS`; deleted `isTitlePromptEvent` + `captureSessionFromHook`).
- Frontend lib 7–12 ✅ (DEFAULT_PTY_*, DEFAULT_TASK_STATUS, hoisted UT storage keys, `discard*` delegation, `SANDBOX_POLL_INTERVAL_MS`, shared `ScopedProject`).
- React UI 13–17 ✅ (deleted dead `AgentSystemBanner`+state+effect+`Icon` import; one `SETTINGS_PANEL_IDS` source w/ derived type+zod enum; `Z_INDEX.popover` token; `openExternal` helper; reuse `showProjectContent`).
- Electron 18–21 ✅ (deleted `ensureAgentCredsProvisionedFor`; named `TERMINAL_IMAGE_NAME_MAX_LEN`/`REMOTE_PTY_REPLAY_TIMEOUT_MS`; `remoteVmSpawnEnv()`; `withOwnerClient()`). Sentinel-prefix sub-item gone (remote-vm restructured).
- Scripts 22–25: `scripts/lib/{cli,hash}.mjs` (`makeFail`, `digestFile`) ✅; `packageManager` from package.json in dev-local ✅; remote-vm.mjs pnpm + item 25 `MISSIONCONTROL_DB_FILENAME` skipped (TS↔mjs boundary / concurrent churn).

**Confirm-list — all resolved.**
- ⚠️ Pinned-slot count ✅ — user confirmed **9**; added `PINNED_SLOT_COUNT` to `keybindings/match.ts`, driving the matcher, `format.ts` label ("1–4"→"1–9"), and ProjectBar's `HOTKEY_LIMIT`.
- ⚠️ `RemoteVmDeployInput` drift ✅ — added the missing `imageStrategy?: "golden" | "full-install"` to the preload bridge type so the renderer can request it.
- ⚠️ `filterProjectsByScope` no-op — left as-is (documented intentional: project sandboxes deliberately don't filter the project list; it's a semantic seam, not dead code).
- ⚠️ Deprecated `AGENT_CLI_VERSION_REQUIREMENTS[_BY_COMMAND]` ✅ — migrated the two electron consumers to `AGENT_CLI_CONFIG[_BY_COMMAND]`, removed the aliases from `agent-cli-config.ts` + the electron re-export.

**Phase 2 — done:** #27 (`CapExceededError` base + `capExceededResponse`), #31 (`local-storage-json` `readJson`/`writeJson`, migrated the clean consumers — user-terminal-store + git-diff-view-store), #32 (`buildDraftTask` delegates to `buildOptimisticTask`), #34 (`dropProjectKeys`/`dropKey` bucket updaters), #36 (`<RemoveProjectConfirmDialog>`), #38 (`catch (e: any)`→`unknown` + `instanceof Error`/`ApiError` narrowing across all 5 sites in `projects.$id.tsx`), #40 (preload generic `subscribe<T>` — all 17 IPC listener blocks), #44 (`scripts/lib/better-sqlite.mjs`), #45 (`MC_AGENT_ENV_KEYS` drives the opencode plugin shell.env passthrough).

**Phase 2 — not done (dispositioned):**
- #28 `findAccountLink` — ⊘ OBSOLETE (`support.controller` deleted).
- #30 project update/getOne hosted-vs-local — ⊘ OBSOLETE (hosted path removed; no branching remains).
- #33 `killPty`/`writePty` transport-resolver — ⊘ OBSOLETE/concurrent (the remote-pty API was restructured in `electron-contract.ts` by the hosted/remote-pty refactor; this code is the concurrent owner's).
- #26 `withDomainErrors` — ⏸ DEFERRED (32 handler sites across 12 controllers; wrapping each body in a closure + re-indenting is high edit-surface and conflict-prone while controllers are still settling — best as a dedicated PR).
- #29 settings.controller table-drive update — ⏸ DEFERRED (⚠️ 90-line if-ladder; each key→setting mapping must be verified exactly; do as a focused PR).
- #35 `<StatusNotice>` — partially superseded (the cross-file copy in `index.tsx` was removed by the concurrent refactor; only 2 in-file instances remain in `projects.$id.tsx`).
- #37 `<CodeBox>` / `<MonoPathBox>` — ⏸ DEFERRED (cosmetic style-box dedup inside the 3.3k-line `projects.$id.tsx`; best folded into the #47 file-split).
- #39 `runRemoteVmCli`, #41 split `registerSandboxManager`, #42 `classifyDeployExit`, #43 `scripts/lib/dev-port`+`dotenv` — ⏸ DEFERRED (all sit in the actively-churned remote-vm / sandbox-manager / dev-script zone the concurrent refactor owns).

**Phase 3 — dispositioned (all L-effort, gate-per-item):**
- #46 unify warm-pool modules — ⏸ DEFERRED (the two modules are now closely aligned — shared `ScopedProject`, `discard*` delegation, `buildDraftTask`→`buildOptimisticTask` — so a `createWarmPool<TSlot>` extraction is set up, but it rewrites core terminal-spawn machinery; do as a dedicated, well-tested PR).
- #47 carve up `projects.$id.tsx`, #48 unify persisted sandbox schema (⚠️ TS↔.mjs), #49 `<SegmentedControl>` (⚠️ visual parity) — ⏸ DEFERRED (large/structural in churned files; gate per-item as separate PRs).

> Net: every item triaged. All behavior-preserving items that were safe and not obsolete/concurrent-owned are landed and validated (`tsc` 0 / `tsc -p electron` 0 / vitest green). New shared modules: `src/shared/{tcp-port,safe-json,short-id,err-msg}.ts`, `src/lib/{scoped-project,z-index,open-external,local-storage-json}.ts`, `src/components/views/RemoveProjectConfirmDialog.tsx`, `scripts/lib/{cli,hash,better-sqlite}.mjs`.
