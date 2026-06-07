# Removal Plan — Strip Daytona + Academy Auth + Web-UI Mode + Local-Docker Sandboxes

> **Status:** Plan only. No code changed yet.
> **Goal:** Revert Mission Control to a **local Electron** app (git worktrees, terminals, agent sessions) **plus the AWS / remote-VM sandbox feature**, removing the deferred hosted-SaaS direction.
> **Method:** Mapped by 5 parallel sub-agents + a follow-up local-docker↔remote-vm boundary pass.

---

## 1. Confirmed scope decisions

The codebase has **three stacked "sandbox/runtime" layers** plus an auth/license axis. Per owner decision:

| Layer / axis | Verdict | Notes |
|---|---|---|
| **A. Hosted web SaaS** — Daytona remote PTY (`@daytona/sdk`), `../academy` OAuth/session auth, hosted Postgres, entitlements-from-academy, `web-daytona` browser mode | **REMOVE** | The deferred direction in full. |
| **B. AWS / Remote-VM sandboxes** — desktop app provisions the user's own EC2/DO VM via `scripts/remote-vm.mjs` + Electron, golden-AMI, connects over the mc-agent WebSocket | **KEEP** | Newest active work; the sandbox feature that survives. |
| **C. Local-docker sandboxes** — `local-docker` sandbox kind, per-project Docker container, `host`/`docker` PTY mode, docker-compose | **REMOVE** | But keep the **shared** sandbox plumbing (table, scope system, ScopeDropdown) that remote-vm needs. |
| **Local license Free/Pro** — `license.ts`, 2-project Free cap, Pro key verified with a built-in public key (no academy call) | **KEEP** | Strip only the **academy-hosted** auth/entitlements exchange. |
| **academy.dev as release / auto-update distribution channel** (separate from academy *auth*) | **KEEP** | Update manifest + installer downloads still served by academy. Only academy **authentication** is removed. |

**The central nuance:** B (remote-vm) and C (local-docker) **share** the `sandboxes` table, `scopeId` columns, `ScopeDropdown`, and most sandbox UI/services. We are **not** deleting that shared infrastructure — we are removing the `local-docker` **kind** and the docker PTY mode while keeping everything remote-vm depends on.

---

## 2. What to KEEP (guard rails against over-deletion)

These look hosted/sandbox-ish but **must survive**:

- **Remote-VM / AWS layer:** `scripts/remote-vm.mjs`, `scripts/golden-ami-manifest.json`, `npm run remote-vm` + `preremote-vm`, all `electron/main.ts` `RemoteVm*` deploy-job code, the `electron.remoteVm` / `electron.remotePty` / `electron.remoteGit` IPC namespaces, `electron/sandbox-agent-client.ts`, `electron/railway-preflight.ts`, `src/shared/remote-vm-deploy-error.ts`, `src/lib/remote-vm-deploy.ts`, `use-remote-vm-deploy-for-sandbox.ts`, `project-sandbox-create.ts`, `optimistic-sandbox.ts`, `project-scoped-sandboxes.ts`, `sandbox-busy.ts`, `use-project-sandbox-flow.tsx`, and the remote-vm parts of `ScopeDropdown.tsx`, `ProjectSandboxDialog.tsx`, `SandboxConfigModal/Panel.tsx`, `SandboxApiKeyField.tsx`, `SandboxProvisioningState.tsx`, `SandboxResumingOverlay.tsx`.
- **Shared sandbox/scope plumbing:** the `sandboxes` table, `services/sandboxes.ts`, `repositories/sandboxes.repo.ts`, `services/sandbox-scope.ts`, `scopeId` columns on `tasks`/`userTerminals`/`homeTerminals`, `LOCAL_SCOPE_ID`, and the keep-able exports of `src/shared/sandbox.ts`.
- **Local license/Pro:** `src/server/services/license.ts`, `license-crypto.ts`, `license-storage.ts`, `controllers/license.controller.ts`, the `GET/DELETE /api/license` + `POST /api/license/validate` routes, `src/shared/license.ts`, `FREE_PROJECT_CAP` / `FREE_SANDBOX_CAP` enforcement in `services/projects.ts` & `services/sandboxes.ts`, `MC_LICENSE_PUBLIC_KEY` env, the `LicenseSettingsPage` / `LicenseBadge` / `LicenseEntryModal` UI. *(The academy-hosted `subscriptionEntitlement` system is different — that goes.)*
- **Security primitives:** `src/server/auth.ts` bearer-token auth + loopback origin gate (`requireLocalOrigin`, `isSameOriginRequest`), `src/server/__tests__/origin-gate.test.ts`. Only the `isHostedMode()` branch inside `auth.ts` is hosted-specific.
- **Local DB:** SQLite — `drizzle.config.ts` (`dialect: sqlite`), `src/db/schema.ts`, `src/db/migrations/`, `src/server/repositories/*`, `better-sqlite3`, `db:generate` / `db:push`.
- **academy as distribution:** `src/shared/academy.ts`, `src/queries/mission-control-version.ts`, the purchase link in `LicenseEntryModal`, `electron/update-manager.ts`, `release.yml` academy publish steps, the `agentsystem.dev/downloads` update URL.
- **`ws`** dependency (used by `electron/sandbox-agent-client.ts`), **`tar`** (used by local skills install), **`session.clone`** hotkey in `TerminalPane` (session duplication, *not* sandbox-repo clone).

---

## 3. Removal inventory (by phase)

Phases are ordered so the build stays as compilable as possible. Within the hosted teardown, the hosted services + `hosted-pg` + `hosted-auth-context` + daytona/academy/support/remote-pty controllers form **one compile unit** — they must land together (Phases 1–3).

### Phase 1 — Daytona hosted remote-PTY (Layer A core)

**Delete:**
- `src/server/services/daytona-remote-pty.ts`
- `src/server/services/remote-agent-hooks.ts`
- `src/server/controllers/remote-pty.controller.ts`
- `scripts/create-daytona-agent-snapshot.mjs`
- `docker/daytona-agent/` (Dockerfile)
- `src/server/services/__tests__/daytona-remote-pty.test.ts`
- `src/server/controllers/__tests__/remote-pty.controller.test.ts`

**Edit:**
- `src/server/api-router.ts` — remove `import * as remotePtyController` (~L34); remove the `/api/remote-pty` route block (~L557–569); remove the `HOSTED_SESSION_ONLY_ROUTES` daytona entries (~L162–166) and the now-dead `acceptsHostedSessionOnly` (~L279–283).
- `src/server/controllers/support.controller.ts` — drop `listActiveRemotePtySummaries` import + the `remoteSessions` field (~L6, L418). *(File is deleted wholesale in Phase 2 anyway.)*
- **Client (Layer A, see Phase 4):** `src/lib/api.ts` remote-pty client methods (`createRemotePty`/`writeRemotePty`/`resizeRemotePty`/`killRemotePty`/`replayRemotePty`/`createRemotePtyTicket`, ~L429–460 + `RemotePtyCreateBody` ~L66) and the daytona branch in `TerminalPane.tsx`. **Note:** keep the `electron.remotePty` branch — that's remote-vm, not daytona.

### Phase 2 — Academy auth + entitlements-from-academy (Layer A)

**Delete:**
- `src/server/services/academy-auth.ts`
- `src/server/hosted-auth-context.ts` *(exports `HostedAuthContext`, the type backbone of the whole hosted data layer — deletes cleanly only once Phase 3 lands)*
- `src/server/services/entitlements.ts` *(the academy/Postgres `subscriptionEntitlement` reader — distinct from local license)*
- `src/server/services/hosted-plan-limits.ts`
- `src/server/controllers/academy-auth.controller.ts`
- `src/server/controllers/entitlements.controller.ts`
- `src/server/controllers/support.controller.ts`
- `src/server/services/launch-kit.ts` + `src/server/controllers/launch-kit.controller.ts` *(academy-network-coupled tarball download; the local `isAcademyTier` flag in `shared/license.ts` may stay)*
- `src/shared/entitlements.ts`
- Tests: `src/server/services/__tests__/academy-auth.test.ts`, `__tests__/entitlements.test.ts`
- `e2e/academy-auth-flow.spec.ts`, `playwright.academy-auth.config.ts`

**Edit:**
- `src/server/api-router.ts` — remove imports for `academyAuthController`, `entitlementsController`, `supportController`, `launchKitController`, `getHostedAuthContext`, `readEntitlements`, and `academyAuthRateLimit` (keep `hookCallRateLimit`). Empty out `ANONYMOUS_ROUTES` (the 4 `/api/academy-auth/*` entries). In `requireApiAuth` (~L232–311) remove the anonymous-academy branch, the academy rate-limit call, `acceptsHostedSessionOnly`, and the `acceptsHostedSessionOrBearer` + entitlement gate — **keep** the `/api/events` SSE-ticket bypass and the final `requireBearerToken` fallthrough. Drop `HOSTED_SESSION_OR_BEARER_ROUTES` / `HOSTED_SESSION_ONLY_ROUTES` / `matchesRoute` / `isHostedSupportRoute`. Remove route registrations for academy-auth, entitlements, support, launch-kit. **Keep** the license routes.
- `src/server/services/rate-limits.ts` — remove `academyAuthRateLimit`; keep `rateLimit`, `requestIp`, `hookCallRateLimit`, `resetRateLimitsForTests`. `remotePty*RateLimit` dies with Phase 1/3.
- `src/server/auth.ts` — simplify `isHostedMode()` (~L89–91) and the hosted branch of `isSameOriginRequest` (~L119–125) to local-only. Keep bearer + loopback gate.
- `src/server/__tests__/api-auth.test.ts` — drop academy/entitlements/support/remote-pty/launch-kit assertions from `PROTECTED_ROUTES` / `ANONYMOUS_ROUTES`; keep license-route + bearer assertions.
- Verify `src/server/services/_skills-install-helpers.ts` (`licenseAuthHeaders`) is still used by the diagram-skill installer before touching it.

### Phase 3 — Hosted SaaS data layer + Postgres (Layer A)

**Delete:**
- `src/server/services/hosted-alerts.ts`, `hosted-cleanup-outbox.ts`, `hosted-groups.ts`, `hosted-hook-tokens.ts`, `hosted-logs.ts`, `hosted-metrics.ts`, `hosted-projects.ts`, `hosted-runtime-usage.ts`, `hosted-user-terminals.ts`
- `src/server/hosted-pg.ts`
- `src/server/controllers/metrics.controller.ts`
- `src/shared/hosted-workspace.ts` *(verify no local-docker/remote-vm consumer of `SANDBOX_WORKSPACE_ROOT` first; its known importers `hosted-user-terminals.ts` + `daytona-remote-pty.ts` are being deleted)*
- `src/server/services/__tests__/hosted-projects.test.ts`, `src/shared/__tests__/hosted-workspace.test.ts`

**Edit — strip the `getHostedContext()` / `if (hosted) {…}` branch in each dual-mode controller, keep the local SQLite path beneath it:**
- `groups.controller.ts`, `user-terminals.controller.ts`, `projects.controller.ts`, `tasks.controller.ts`, `diagrams.controller.ts`, `worktrees.controller.ts`, `hooks.controller.ts`, `events.controller.ts`
- `home-terminals.controller.ts` — drop the `isHostedDatabaseEnabled` guard; home terminals are already local-only (always-available).
- `health.controller.ts` — remove the Postgres pool check; collapse `database` to `"disabled"` or drop the field.
- `entitlements.controller.ts` — **keep** (local needs it); always return `readEntitlements(null, { hostedEnabled: false })`.
- `src/server/services/entitlements.ts` *(if kept instead of deleted — see note)* — remove the `getHostedPool` import + Postgres subscription query; keep the local-license fallback. **Decide:** if `entitlements.ts` only served academy, delete it (Phase 2) and have `entitlements.controller.ts` compute purely from local license.
- `src/server/api-router.ts` — remove `scheduleHostedCleanupOutboxWorker()` (~L359), `withHostedLogContext` wrapper (~L367), `incrementHostedCounter` / `reportHostedServerException` in `withApiAuth` (keep the `console.error` + 500), and the `/api/metrics` route.
- `src/server/events.ts` — remove `scopeForHostedContext` / `HostedAuthContext` usage.

**DB:** SQLite is untouched by Phase 3. The hosted Postgres schema lives entirely under `docker/postgres/` and is deleted in Phase 6 (no migration history to preserve).

### Phase 4 — Web-UI mode + hosted/license-paywall client (Layer A)

**Delete:**
- `src/components/views/AuthGate.tsx`
- `src/routes/plans.tsx` *(then re-run the TanStack route generator so `/plans` leaves `routeTree.gen.ts`)*
- `src/lib/hosted-session-summary.ts` + its test
- `src/lib/hosted-cleanup-status.ts` + its test

**Edit (collapse `web-daytona` → local; the app is always Electron now):**
- `src/lib/runtime.ts` — make `getClientRuntime()` always `"electron-local"` (or remove the abstraction); coordinate with `src/shared/runtime.ts` (drop `"web-daytona"` from `MissionControlRuntime`; `MISSION_CONTROL_RUNTIME_HEADER` becomes vestigial — keep the header send in `api.ts` as benign, or drop).
- `src/server/request-runtime.ts` — drop the `"web-daytona"` branch in `getRequestRuntime`; **keep** `isElectronLocalApiRequest` (≈74 callers rely on it as the trusted-local gate) — simplify it to the bearer check.
- Resolve every `isWebDaytonaRuntime()` call site to its local branch: `src/queries/index.ts` (~L5, L53–60 `HOSTED_LICENSE_STATE`, L140), `src/queries/git.ts` (~L10, L36/50/67 `enabled:` clauses), `src/lib/add-project-store.tsx` (~L14, L32–45 the web early-return), `src/routes/index.tsx` (~L42, hosted copy + launch-kit), `src/components/views/ProjectDialog.tsx` (~L10, L64–66 + hosted-create form branches).
- `src/routes/__root.tsx` — unwrap `<AuthGate>`; remove `ScopeDropdown` **only if** the header scope switcher is dropped — **NO, keep ScopeDropdown for remote-vm** (it stays; just ensure it renders without auth). Remove `AuthUserButton`, the `useHostedSession` wiring. **Keep** `LicenseBadge`, terminals, hotkeys, notifications. *(`SandboxResumingOverlay` stays — remote-vm.)*
- `src/routes/index.tsx` — remove `LaunchKitDialog`, `HostedRuntimeNotice`, `useHostedSession`, hosted dashboard copy; keep local copy + project grid.
- `src/components/views/ProjectDialog.tsx` — remove the hosted-create (GitHub-URL) form path; keep local name/path/image/group/worktree fields + folder Browse.
- `src/lib/add-project-store.tsx` — keep the **local** license paywall (402 → `LicenseEntryModal`) since license stays; remove only the `isWebDaytonaRuntime()` early-return.
- `src/lib/settings-navigation.ts` — remove the `/plans` return-location branch.

**Keep (do not delete in Phase 4):** `LicenseEntryModal`, `LicenseSettingsPage`, `LicenseBadge`, and all `Sandbox*` / `ScopeDropdown` / remote-vm UI listed in §2.

### Phase 5 — Local-docker sandbox kind (Layer C; keep remote-vm)

This is the most surgical phase. Goal: `SANDBOX_KINDS` becomes `["remote-vm"]`; the `host`/`docker` PTY mode disappears (terminals run on host PTY, or connect to a remote-vm). The `sandboxes` table, scope system, and remote-vm flow stay.

**Delete (local-docker-only):**
- `electron/sandbox-compose.ts` + `electron/__tests__/sandbox-compose.test.ts` (docker-compose orchestration)
- `docker/sandbox-base/` (Dockerfile — `mission-control/sandbox-base:latest`, the compose default image)
- `docker/sandbox-agent/` (Dockerfile — **verify** it isn't reused by remote-vm/golden-AMI before deleting)
- `src/lib/sandbox-runtime.ts` (`isDockerSandboxRuntime` / `readSandboxRuntimeMode`) + `src/lib/__tests__/sandbox-runtime.test.ts`

**Edit (remove `local-docker` branches / `docker` PTY mode, keep `remote-vm` + shared):**
- `src/shared/sandbox.ts:7` — `SANDBOX_KINDS = ["remote-vm"]`. Remove the local-docker-only fields from `SandboxPublicView` (`imageTag`, `dockerfilePath`, `buildArgKeys`, `hasBuildArgs`, docker-specific `gitAuthMode` usage, `declaredPorts` if docker-only). Keep all `Remote*` types, `normalizeRemoteAgentUrl`, `LOCAL_SCOPE_ID`, scope helpers.
- `src/shared/electron-contract.ts` — drop the `SandboxRuntimeMode` (`host`/`docker`) type and any local-docker-only fields in the `sandbox:` namespace; keep `remoteVm:` / `remotePty:` / `remoteGit:` and the shared registry/scope methods.
- `src/server/services/sandboxes.ts:161` — default kind `remote-vm` instead of `local-docker`; remove local-docker create validation (image/dockerfile/build-args) while keeping remote-vm + `FREE_SANDBOX_CAP`.
- `src/db/schema.ts:33` + `src/db/client.ts:321,503` + `src/db/migrate-multi-sandbox.ts:50` + `scripts/remote-vm.mjs:1036,1059` — flip the `kind` column default to `'remote-vm'`. Keep the table. **Data note:** existing `local-docker` rows in dev DBs should be deleted/ignored (they were the owner's own experiment); no destructive column drop is required — the local-docker-only columns can stay unused or be dropped in a later optional migration.
- **TerminalPane.tsx** — remove the docker PTY branch (`isDockerSandboxRuntime`, `useSandbox` docker path, `SandboxCloneOfferBanner` if docker-only — **verify** clone-offer isn't also remote-vm). Keep the host `electron.pty` path **and** the `electron.remotePty` (remote-vm) path. Remove the deleted daytona `api.createRemotePty` branch (Phase 1).
- Collapse `isDockerSandboxRuntime` callers to the host branch: `src/lib/user-terminal-store.tsx` (~L25, L387), `src/lib/project-fs.ts` (~L6, L24), `src/lib/session-warm-pool.ts` (~L10, L156), `src/lib/user-terminal-warm-pool.ts` (~L5, L94), `src/routes/projects.$id.tsx` (~L33, L1068).
- **`electron/sandbox-manager.ts` (47KB, MIXED)** — remove the local-docker/compose/image-build code paths (`kind === "local-docker"` at ~L1264, `sandbox-compose` usage); keep the shared registry/store/scope-state and the remote-vm connect/deploy logic. ⚠️ **Recommend a dedicated mapping pass (or one focused sub-agent) at execution time** to cleanly separate local-docker compose/image logic from shared + remote-vm logic in this file.
- `electron/sandbox-registry.ts` (~L275 kind branch), `electron/sandbox-store.ts` (~L64 kind mapping → default remote-vm), `electron/sandbox-connect-errors.ts` (kind param), `electron/sandbox-types.ts` (~L27 kind union), `electron/sandbox-settings.ts`, `electron/sandbox-ports.ts` — remove local-docker branches; **verify** which of `sandbox-settings`/`sandbox-ports` are docker-specific vs shared.
- `src/components/views/SandboxConfigPanel.tsx:46` — drop the `local-docker` kind option from the config form; keep remote-vm config.
- `src/lib/__tests__/project-scoped-sandboxes.test.ts`, `src/server/services/__tests__/projects.test.ts:146`, `src/db/__tests__/migrate-multi-sandbox.test.ts`, `electron/__tests__/sandbox-registry.test.ts` — update fixtures from `local-docker` to `remote-vm`.

### Phase 6 — Cross-cutting plumbing

**`package.json` — remove deps:** `@daytona/sdk`, `pg`, `@types/pg`, `@playwright/test` *(after e2e specs go)*. **Keep:** `ws`, `tar`, `better-sqlite3`, `electron-updater`. *(No `@aws-sdk`/`aws-sdk` exists — remote-vm shells out to the AWS CLI.)*

**`package.json` — remove scripts:** `start:hosted` + `prestart:hosted`, `dev:web` + `predev:web`, `dev:server`, `daytona:snapshot` + `predaytona:snapshot`, `test:e2e:academy-auth` + pre-hook, and the hosted half of `build:web` (drop the `vite build -c vite.config.server-entry.ts` step — **keep** the renderer `vite build`). Review `test:e2e` (only ran hosted specs). Remove `dist-server/**/*` from `build.files`. **Keep** `remote-vm` + `preremote-vm`, `db:generate`/`db:push`, and `build.extraResources` for `docker/sandbox-base`?? — **remove** that extraResource (local-docker image is gone).

**Build/config — delete:** `scripts/serve-hosted.mjs`, `vite.config.server-entry.ts`, `playwright.config.ts`, `playwright.academy-auth.config.ts`, `docker-compose.yml`, `docker/postgres/` (whole tree). **Edit:** `vite.config.ts` — keep `__MC_LICENSE_PUBLIC_KEY__` (license stays). `.github/workflows/hosted-ci.yml` — drop `web-build` / `browser-tests` / `postgres-migrations` jobs; preserve `typecheck`/`unit-tests`/`lint`/`secret-scan` (rename to `ci.yml`). `release.yml` — keep academy publish/update steps (distribution channel).

**Env (`.env.example`) — remove:** all `ACADEMY_*` + `VITE_ACADEMY_BASE_URL`, `POSTGRES_PORT`, `DATABASE_URL`, `MC_SESSION_*`, `MC_SUPPORT_API_TOKEN`, `MISSION_CONTROL_PUBLIC_URL`, all `DAYTONA_*`, `MC_REMOTE_RUNTIME_DISABLED`, `MC_MAX_*_PER_USER`, `MC_*_RATE_LIMIT_*`, `MC_REMOTE_PTY_*`, `MC_MAX_COMPUTE_*`, `MC_COMPUTE_LIMIT_WINDOW_DAYS`, `MC_PLAN_LIMITS_JSON`, `MC_BLOCKED_*`, `MC_ALERT_*`. **Keep:** `MC_LICENSE_PUBLIC_KEY`.

**Docs — delete:** `docs/docker-sandbox-runner-plan.md`, `docs/hosted-deployment.md`, `docs/hosted-operations-runbook.md`, `docs/hosted-saas-launch-checklist.md`, `docs/multi-sandbox-plan.md` *(local-docker plan)*, `docs/project-sandbox-workflow-request.md`. **Keep:** `docs/project-sandbox-aws-flow.md`, `docs/remote-vm-cli.md` (remote-vm), `docs/agent-status-detection.md`, `docs/worktree-implementation-plan.md`, `docs/skills/`. **README.md** — delete the "### Hosted Web" section + `pnpm dev:web` line; keep "### Remote VM Sandboxes". **SPEC.md** — no hosted sections; no change.

**e2e — delete:** `e2e/hosted-smoke.spec.ts`, `e2e/academy-auth-flow.spec.ts` (dir becomes empty).

**electron/ — Layer A has ~zero coupling.** Only `electron/update-manager.ts:340` has an academy *comment* (auto-update channel — keep; optionally clean the comment). All electron `sandbox-*` / `RemoteVm*` work is Phase 5 / kept.

---

## 4. Suggested execution order & verification

1. **Phases 1–3 together** (hosted teardown is one compile unit) → `pnpm typecheck` server.
2. **Phase 4** (web-UI client) → `pnpm typecheck` + boot the Electron app; confirm no AuthGate, app loads straight to projects.
3. **Phase 5** (local-docker) → typecheck; **manually create a remote-vm sandbox** end-to-end to confirm the shared scope/registry/PTY paths still work after the docker split.
4. **Phase 6** (plumbing) → `pnpm lint`, `pnpm test` (unit), `pnpm build` (Electron), `db:generate` (confirm no schema drift).
5. Re-run the TanStack route generator (Phase 4 deleted `/plans`).
6. Grep sweep for orphans: `daytona`, `academy` (excluding update/distribution + `shared/academy.ts`), `web-daytona`, `hosted-`, `local-docker`, `isDockerSandboxRuntime`, `getHostedAuthContext`, `DATABASE_URL`.

---

## 5. Open items to verify during execution

1. **`electron/sandbox-manager.ts` local-docker/remote-vm split** — the one genuinely intricate file; map it before cutting (§Phase 5).
2. **`docker/sandbox-agent`** — confirm it's local-docker-only and not reused by remote-vm/golden-AMI before deleting.
3. **`SandboxCloneOfferBanner` / clone-into-sandbox in TerminalPane** — confirm whether it's docker-only or also serves remote-vm before removing.
4. **`src/shared/hosted-workspace.ts` `SANDBOX_WORKSPACE_ROOT`** — confirm no remote-vm/local consumer before deleting the file.
5. **`entitlements.ts` / `entitlements.controller.ts`** — decide delete-vs-keep-local (the controller stays for the local app; the service may be deletable if it only read academy Postgres).
6. **`shared/license.ts:isAcademyTier`** — becomes dead once launch-kit is removed unless any kept UI uses it; prune if orphaned.
7. **`build:web` / renderer build** — confirm how the local Electron build consumes the renderer before trimming the script (likely keep `vite build`, drop only the server-entry step).
8. **`docker/sandbox-base` extraResource in `package.json`** — remove with the local-docker image.

---

## 6. Sub-agent provenance

Mapped by 5 parallel sub-agents — (1) daytona/remote-PTY runtime, (2) academy auth + license/entitlements, (3) web-UI/sandbox client, (4) hosted services + AWS/remote-vm, (5) config/deps/docs/DB — plus a follow-up local-docker↔remote-vm boundary pass. The agents independently converged on the three-layer model and flagged the AWS/remote-vm + local-license keep decisions that this plan now reflects.
