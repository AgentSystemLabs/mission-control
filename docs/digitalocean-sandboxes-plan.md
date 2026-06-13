# DigitalOcean Sandboxes — Phased Implementation Plan

Status: **not started** — exploration complete (2026-06-08), ready for Phase 2.

Use this document as a **sequential checklist**. Complete each phase in order. Do not skip to audit phases until Phase 2 implementation is done and tests are green.

---

## Product Goal

Add **DigitalOcean** as a second managed cloud provider for project sandboxes, alongside the existing **AWS EC2** path. Users should be able to:

- Choose a provider when creating a sandbox (or via CLI for v1)
- Deploy, pause, resume, reconcile, and destroy DO droplets with the same lifecycle UX as AWS
- Connect the Mission Control agent over `wss://<public-ip>:443/` with the same pairing-token model

**Non-goals for v1**

- Settings UI for storing DO API tokens in-app (mirror AWS: host env / `doctl`)
- Golden snapshot fast-boot pipeline (full-install only initially)
- Replacing or removing AWS support

---

## Architecture Snapshot (from exploration)

```
Renderer (React)
  → electron.remoteVm.startDeploy({ provider })
  → Electron main (deploy job queue, spawn CLI)
  → scripts/remote-vm.mjs deploy <provider> ...
  → Cloud API (AWS CLI today; doctl or DO REST for DO)
  → SQLite sandboxes.remote_config (written by CLI, not HTTP API)
  → HTTP GET/PATCH/DELETE /api/sandboxes (read + scope + metadata only)
  → Electron sandbox registry (WebSocket agent connect)
```

**Current abstraction score: ~2.5/10.** AWS is inlined across CLI, Electron, types, and UI. DO is greenfield on top of a provider-neutral data model (`remote_config.provider`, `providerId`, lifecycle statuses).

**Key files to touch**

| Layer | Files |
|-------|-------|
| CLI / provider | `scripts/remote-vm.mjs`, new `scripts/providers/*.mjs` |
| Electron IPC | `electron/main.ts`, `electron/preload.ts` |
| Shared types | `src/shared/electron-contract.ts`, `src/shared/sandbox.ts` |
| Create flow | `src/lib/project-sandbox-create.ts`, `ProjectSandboxDialog.tsx` |
| Scope / lifecycle UI | `ScopeDropdown.tsx`, `SandboxConfigPanel.tsx` |
| Scoping filters | `project-scoped-sandboxes.ts`, `activate-sandbox-scope.ts` |
| Optimistic cache | `src/lib/optimistic-sandbox.ts` |
| Tests | `src/lib/remote-vm-script.test.ts`, new `providers.do.test.ts` |

---

## TDD Contract (applies to all of Phase 2)

Follow the **existing AWS pattern**: test exported pure helpers first; avoid spawning real cloud CLIs in CI.

**Rules**

1. Write a failing test **before** each helper or type change.
2. Run `pnpm vitest run <file>` after each sub-phase.
3. Run full gate before Phase 3: `pnpm typecheck && pnpm lint && pnpm test`.
4. No Phase 2 sub-phase is “done” until its tests pass.

**Test commands**

```bash
pnpm vitest run src/lib/remote-vm-script.test.ts
pnpm vitest run src/lib/__tests__/optimistic-sandbox.test.ts
pnpm vitest run src/lib/__tests__/project-scoped-sandboxes.test.ts
pnpm vitest run src/server/__tests__/sandboxes-api.test.ts
pnpm typecheck && pnpm lint && pnpm test
```

---

## Phase 1: Exploration & Planning

**Purpose:** Understand the codebase and lock scope before writing provider code.

**Status:** Completed by codebase exploration (five parallel audits). Validate each item yourself before starting Phase 2.

### 1.1 Architecture comprehension

- [x] Map end-to-end flow: UI → Electron deploy job → `remote-vm.mjs` → SQLite → API list → agent WS connect
- [x] Confirm sandboxes are **not** created via HTTP POST (CLI writes rows directly)
- [x] Confirm lifecycle statuses: `provisioning`, `ready`, `paused`, `pausing`, `resuming`, `missing`, etc.
- [x] Confirm agent connection is **provider-agnostic** (TLS pin + Bearer `pairing_token`)
- [ ] Read `docs/project-sandbox-aws-flow.md` and `docs/remote-vm-cli.md` for AWS reference behavior
- [ ] Manually trace one AWS deploy in dev (optional but recommended)

### 1.2 AWS → DO operation mapping

| MC operation | AWS today | DigitalOcean target |
|--------------|-----------|---------------------|
| Deploy | `ec2 run-instances` + user-data + SG | `POST /v2/droplets` + `user_data` + Cloud Firewall |
| Preflight | `sts get-caller-identity` | `GET /v2/account` or `doctl account get` |
| Pause | `stop-instances` | Droplet action `power_off` |
| Resume | `start-instances` + re-read public IP | Droplet action `power_on` + re-read `networks.v4` |
| Destroy | `terminate-instances` | `DELETE /v2/droplets/{id}` |
| Reconcile | `describe-instances` → status map | `GET /v2/droplets/{id}` → `off`/`active`/404 |
| Firewall | Security group TCP 443 (+ optional 22) | Cloud Firewall inbound rules |
| Default size | `t3.medium` | `s-2vcpu-4gb` (2 vCPU, 4 GiB) |
| Default region | `us-east-1` | `nyc3` (or chosen default) |
| Image | Golden AMI or full-install on Ubuntu | `ubuntu-24-04-x64` slug or custom snapshot (v2) |

- [ ] Confirm DO account + API token available for manual QA
- [ ] Confirm `doctl` installed locally OR decide on direct REST client (`@digitalocean/api-client`)
- [ ] Document chosen credential approach: `DIGITALOCEAN_ACCESS_TOKEN` env var (mirror `AWS_PROFILE`)

### 1.3 Hardcoded AWS inventory (must generalize in Phase 2)

- [ ] `RemoteVmDeployInput.provider: "aws"` — `src/shared/electron-contract.ts`
- [ ] `buildRemoteVmDeployArgs` always `["deploy", "aws", ...]` — `electron/main.ts`
- [ ] `deploy aws` only branch — `scripts/remote-vm.mjs`
- [ ] `isManagedAwsRemote()` — `ScopeDropdown.tsx`, `SandboxConfigPanel.tsx`
- [ ] `isAwsProjectSandbox()` — `project-scoped-sandboxes.ts`, `activate-sandbox-scope.ts`
- [ ] `ManagedRemoteDeployProvider = "aws"` — `optimistic-sandbox.ts`
- [ ] `provider: "aws"` hardcoded — `project-sandbox-create.ts`
- [ ] UI copy: "AWS VM", "AWS deploy logs" — `ScopeDropdown`, `SandboxProvisioningState`, `SandboxConfigPanel`
- [ ] Pause/resume/destroy/reconcile throw for non-AWS — `remote-vm.mjs`

### 1.4 Scope decisions (fill in before Phase 2)

| Decision | Choice | Notes |
|----------|--------|-------|
| Provider id string | `digitalocean` | Matches legacy row comments; use in DB + types |
| CLI invocation | `deploy digitalocean` | Parallel to `deploy aws` |
| v1 UI provider picker | Yes / No / CLI-only | Recommend: **CLI-only first**, then UI picker in 2.7 |
| API client | `doctl` subprocess vs REST | Recommend: **doctl** first (mirrors `aws` CLI pattern) |
| Golden image v1 | Skip | Full-install cloud-init only |
| Floating IP on resume | Skip v1 | Document ephemeral IP risk (same as AWS) |
| Legacy `digitalocean` DB rows | Read-only tolerance | Destroy path already no-ops cloud for non-AWS |

- [ ] Stakeholder sign-off on v1 scope (CLI-only vs UI picker on day one)

### Phase 1 exit criteria

- [ ] All checkboxes in 1.1–1.4 reviewed
- [ ] Scope decisions table completed
- [ ] This plan updated with any project-specific choices

---

## Phase 2: Implementation (TDD-driven)

**Purpose:** Ship DigitalOcean sandbox support. Complete sub-phases **in order**. Each sub-phase ends with green tests.

### 2.1 Provider primitives & tests (CLI pure layer)

**Write tests first** in `src/lib/__tests__/remote-vm/providers.digitalocean.test.ts` (or extend `remote-vm-script.test.ts`).

- [ ] **`statusForDoDropletState`** — map `off` → `paused`, `active` → `ready`, gone → `missing`
- [ ] **`shouldPersistDoReconciledStatus`** — compare-and-set rules (mirror AWS CAS tests)
- [ ] **`isDoDropletMissingError`** — 404 / not-found strings → idempotent destroy
- [ ] **`buildDoCreateDropletArgs`** (or equivalent) — region, size slug, image, `user_data`, SSH keys, tags
- [ ] **`buildDoLifecycleArgs`** — power_off, power_on, delete
- [ ] **`createRemoteConfig({ provider: "digitalocean", ... })`** — correct `agentUrl`, `providerName`, `cloud` blob
- [ ] **`preflightDigitalOcean`** — token valid, size slug exists in region
- [ ] **`ensureDoFirewall`** — inbound TCP 443 from `accessCidr`; optional TCP 22

**Implementation**

- [ ] Create `scripts/providers/digitalocean.mjs` with deploy/pause/resume/destroy/reconcile
- [ ] Reuse shared bootstrap: `renderUserData`, `renderBootUserData`, `waitForRemoteAgentHttp`
- [ ] Watch **64 KiB `user_data` limit** — add test asserting encoded size under limit (or split boot vs install)
- [ ] Export new helpers from `remote-vm.mjs` for tests (same pattern as AWS exports)

**Tests green:** `pnpm vitest run src/lib/__tests__/remote-vm/providers.digitalocean.test.ts`

---

### 2.2 Provider registry refactor (CLI routing)

**Tests first**

- [ ] CLI router test: `deploy digitalocean` dispatches to DO module
- [ ] CLI router test: `deploy aws` unchanged (regression)
- [ ] Pause/resume/destroy/reconcile route by `cfg.provider` via registry, not inline `if (aws)`

**Implementation**

- [ ] Extract `scripts/providers/aws.mjs` from monolithic `remote-vm.mjs` (incremental; keep behavior identical)
- [ ] Add `scripts/providers/registry.mjs` — `{ aws, digitalocean }`
- [ ] Update `main()` dispatch: `providers[provider].deploy(flags)`
- [ ] Ensure legacy non-managed providers still delete row-only (regression test exists in `remote-vm-script.test.ts`)

**Tests green:** `pnpm vitest run src/lib/remote-vm-script.test.ts`

---

### 2.3 Shared types & Electron contract

**Tests first**

- [ ] Type compile test: `RemoteVmDeployInput` accepts `{ provider: "digitalocean", ... }`
- [ ] `managedProviderFromDeployInput("digitalocean")` → `"digitalocean"` in `optimistic-sandbox.test.ts`
- [ ] `buildOptimisticRemoteVmSandbox({ remoteProvider: "digitalocean" })` → label `"DigitalOcean"`

**Implementation**

- [ ] Widen `RemoteVmDeployInput.provider` to `"aws" | "digitalocean"` in:
  - [ ] `src/shared/electron-contract.ts`
  - [ ] `electron/preload.ts` (keep in sync — contract drift risk)
  - [ ] `electron/main.ts` inline types
- [ ] Widen `SandboxRemoteConfig.provider` to `"aws" | "digitalocean" | string`
- [ ] Extend `ManagedRemoteDeployProvider` + `MANAGED_PROVIDER_LABELS` in `optimistic-sandbox.ts`
- [ ] Update `buildRemoteVmDeployArgs()` to dispatch provider-specific CLI flags
- [ ] Add DO defaults: region `nyc3`, size `s-2vcpu-4gb`, image `ubuntu-24-04-x64`

**Tests green:** `pnpm vitest run src/lib/__tests__/optimistic-sandbox.test.ts && pnpm typecheck`

---

### 2.4 Scoping & server API (generalize AWS filters)

**Tests first**

- [ ] `scopedSandboxesForProject` shows DO sandboxes on project screen (parameterized test)
- [ ] `projectRuntimeScopeId` allows DO project-owned sandbox
- [ ] `sandboxes-api.test.ts` — seed `provider: "digitalocean"` row; public view exposes `remoteProvider: "digitalocean"`
- [ ] `activate-sandbox-scope.test.ts` — DO sandbox activation path

**Implementation**

- [ ] Replace `isAwsProjectSandbox` with `isManagedProjectSandbox(sandbox)` in `project-scoped-sandboxes.ts`
- [ ] Replace `isManagedAwsRemote` with `isManagedRemoteProvider(sandbox, ["aws", "digitalocean"])` (shared helper, e.g. `src/lib/managed-remote.ts`)
- [ ] Update `activate-sandbox-scope.ts` runtime scope check
- [ ] Update `ScopeDropdown.tsx` reconcile gating to use shared helper
- [ ] Update `projects.$id.tsx` active runtime check if AWS-specific

**Tests green:** `pnpm vitest run src/lib/__tests__/project-scoped-sandboxes.test.ts src/lib/__tests__/activate-sandbox-scope.test.ts src/server/__tests__/sandboxes-api.test.ts`

---

### 2.5 Create flow & deploy orchestration

**Tests first**

- [ ] `extractRemoteVmDeployError` handles DO/doctl failure lines
- [ ] `remoteVmDeployJobForSandbox` works with DO deploy jobs
- [ ] `isMissingRemoteInstanceError` (or DO-specific) covers droplet-not-found patterns

**Implementation**

- [ ] `project-sandbox-create.ts` — pass selected `provider` to `startDeploy` (not hardcoded `"aws"`)
- [ ] Provider-specific defaults (region, size) based on selection
- [ ] Update provisioning toast copy to be provider-aware
- [ ] `use-remote-vm-deploy-for-sandbox.ts` — status copy ("Queued for DigitalOcean deploy", etc.)
- [ ] `SandboxProvisioningState.tsx` — log header provider-aware

**Tests green:** relevant unit tests + manual deploy smoke (see 2.8)

---

### 2.6 Lifecycle UI (pause / resume / destroy / reconcile)

**Tests first**

- [ ] Extract pure handlers from `ScopeDropdown` if needed for testability (optional but recommended)
- [ ] `sandbox-busy.test.ts` still passes (provider-agnostic)

**Implementation**

- [ ] `ScopeDropdown.tsx` — default subtitle from `remoteProviderName` (not hardcoded `"AWS VM"`)
- [ ] `SandboxConfigPanel.tsx` — `providerPauseHint("digitalocean")` (disk/billing copy for DO)
- [ ] `SandboxConfigPanel.tsx` — deploy logs section: `DigitalOcean · {region}`
- [ ] `SandboxConfigPanel.tsx` — managed destroy uses `remoteVm.destroy` for DO (not AWS-only branch)
- [ ] `remote-vm.mjs` — DO pause/resume/reconcile emit `REMOTE_VM_RECONCILE_JSON=` with same shape as AWS
- [ ] `use-project-sandbox-flow.tsx` — gate/error strings mention managed remote, not AWS-only

**Tests green:** `pnpm test` (full suite)

---

### 2.7 UI provider picker (optional for v1 — skip if CLI-only)

**Tests first**

- [ ] Component test or storybook N/A today (no jsdom) — rely on manual QA checklist

**Implementation**

- [ ] `ProjectSandboxDialog.tsx` — provider radio/select (mirror image-strategy card pattern at ~line 219)
- [ ] Show DO region/size fields when DO selected (AWS hides these today)
- [ ] Wire selection through `useProjectSandboxFlow` → `createProjectSandbox`

**Manual QA:** create sandbox via UI with each provider

---

### 2.8 Integration smoke & documentation

**Manual smoke checklist (requires real credentials)**

- [ ] `pnpm remote-vm deploy digitalocean --region nyc3 --size s-2vcpu-4gb --name test-do` succeeds
- [ ] Sandbox appears in Scope dropdown with `Provisioning…` → `ready`
- [ ] Agent connects; terminal runs command on droplet
- [ ] Pause → `paused`; resume → `ready` + reconnect
- [ ] Reconcile after manual power-off in DO console → `paused` prompt
- [ ] Destroy → row removed; no resurrection flicker (see `destroyingIdsRef` pattern)
- [ ] Concurrent deploy + reconcile poll does not resurrect mid-teardown row

**Docs**

- [ ] Add DigitalOcean section to `docs/remote-vm-cli.md`
- [ ] Update `README.md` with DO prerequisites (`doctl`, token env var)

### Phase 2 exit criteria

- [ ] All 2.1–2.8 sub-phases complete (2.7 optional per scope)
- [ ] `pnpm typecheck && pnpm lint && pnpm test` — all green
- [ ] Manual smoke checklist passed on at least one DO droplet
- [ ] No remaining `remoteProvider === "aws"` guards that should be provider-generic (grep audit)

---

## Phase 3: Security Audit

**Purpose:** Verify DO integration does not introduce authz, secret leakage, or abuse surfaces.

Run **after** Phase 2 is complete. Use `/audit-authz` and security regression mindset on the **full diff vs `main`**.

### 3.1 Credentials & secrets

- [ ] DO API token never written to `remote_config`, SQLite, logs, or client bundle
- [ ] Token read only from env / `doctl` config on host (same trust model as AWS CLI)
- [ ] Deploy logs redact token if doctl prints headers
- [ ] `pairing_token` still server-only reveal via `/api/sandboxes/:id/api-key` (desktop gate)
- [ ] No `DIGITALOCEAN_ACCESS_TOKEN` in renderer, preload, or Vite client chunks

### 3.2 Network & firewall

- [ ] Inbound TCP 443 restricted to caller `accessCidr` (not `0.0.0.0/0`) by default
- [ ] SSH (22) only opened when explicitly requested (mirror AWS optional key path)
- [ ] Agent TLS sidecar still binds loopback; public termination on 443 only
- [ ] Cert pin (`agentCa`) unchanged; no downgrade to plaintext without explicit flag
- [ ] Floating IP / reserved IP docs warn about IP binding if added later

### 3.3 Authorization & IDOR

- [ ] `DELETE /api/sandboxes/:id` still desktop-only; cannot delete another user's sandbox in multi-user future
- [ ] `setActiveScope` cannot activate sandbox not visible to current project (`sandbox-scope.ts`)
- [ ] DO destroy requires same Electron gate as AWS (no renderer bypass)
- [ ] Webhook handlers N/A — confirm no new public endpoints

### 3.4 Input validation

- [ ] Region/size/image slugs validated in CLI preflight (reject shell injection in args)
- [ ] `user_data` size bounded; no arbitrary file read into cloud-init
- [ ] Deploy job input validated in Electron before spawn

### 3.5 Dependency & supply chain

- [ ] If adding `@digitalocean/api-client`, pin version; audit license
- [ ] No new native deps without justification

### 3.6 Security audit execution

- [ ] Run static security regression on changed files (secrets, SSRF, open redirects, unsafe HTML)
- [ ] Run authz audit on server entry points touched by sandbox changes
- [ ] File findings with severity + file:line refs
- [ ] Fix all **critical** and **high** findings before release
- [ ] Re-run audit until clean or accepted risks documented

### Phase 3 exit criteria

- [ ] Security checklist 3.1–3.5 satisfied
- [ ] No unresolved critical/high findings
- [ ] Findings log appended to bottom of this doc or linked issue

---

## Phase 4: Performance Audit

**Purpose:** Ensure DO path does not regress hot paths (dropdown, reconcile poll, deploy refresh).

Run **after** Phase 3. Focus on changed code paths.

### 4.1 API & database

- [ ] `GET /api/sandboxes` still single query; no N+1 for DO rows
- [ ] `remote_config` JSON parse cost unchanged (DO rows same shape)
- [ ] No new indexes required unless filtering by `provider` at scale (note if >100 sandboxes)

### 4.2 Reconcile & polling

- [ ] `MANAGED_REMOTE_RECONCILE_POLL_MS` (60s) — DO reconcile does not block UI thread
- [ ] Per-sandbox `reconcileInFlightRef` prevents duplicate DO API calls
- [ ] TTL cache (`MANAGED_REMOTE_RECONCILE_TTL_MS` 30s) applies to DO sandboxes
- [ ] DO API rate limits (5k/hr) — backoff on 429; no tight loops in deploy wait

### 4.3 Deploy & cache

- [ ] `mergeServerSandboxesPreservingPending` still O(n) on sandbox count
- [ ] `destroyingIdsRef` prevents redundant refetch work mid-teardown (regression check)
- [ ] Optimistic row merge does not duplicate DO + AWS pending jobs

### 4.4 Client bundle

- [ ] No DO SDK imported into renderer/client routes
- [ ] Provider labels/constants tree-shakeable

### 4.5 Performance audit execution

- [ ] Run `/audit-perf` on `ScopeDropdown.tsx`, `remote-vm.mjs`, `project-sandbox-create.ts`
- [ ] Review sequential `await` chains in DO deploy (parallelize independent preflight calls if any)
- [ ] Document acceptable latencies: deploy (minutes), reconcile (seconds), scope switch (<200ms perceived)

### Phase 4 exit criteria

- [ ] No **high** perf findings unaddressed
- [ ] Reconcile poll + deploy listener do not cause measurable UI jank
- [ ] Performance notes recorded below if trade-offs accepted

---

## Phase 5: Clean Code & Maintainability Audit

**Purpose:** Ensure multi-provider support is readable, DRY, and safe to extend to a third provider.

Run **after** Phase 4.

### 5.1 Duplication & abstraction

- [ ] Single `isManagedRemoteProvider()` helper — no copy-pasted `=== "aws"` / `=== "digitalocean"`
- [ ] Provider registry in CLI is the only dispatch table (no scattered `if (provider)`)
- [ ] `ManagedRemoteDeployProvider` union is single source for labels + optimistic status
- [ ] Pause hint copy centralized (`providerPauseHint(provider)`)
- [ ] Shared fixtures: `src/lib/__tests__/fixtures/sandbox-fixtures.ts` for AWS + DO rows

### 5.2 Type safety

- [ ] Eliminate triple type definitions for deploy input (contract / preload / main) — one import from `electron-contract.ts`
- [ ] `SandboxRemoteConfig` documents CLI-only fields or uses shared Zod parse at read boundaries
- [ ] No new `any` or `@ts-ignore` in changed files
- [ ] `RemoteVmLifecycleStatus` sufficient for DO or extended with explicit union members

### 5.3 Contracts & drift

- [ ] `RemoteVmDeployJobSnapshot.input.provider` matches CLI argv
- [ ] `toPublicSandbox()` maps DO `cloud` blob fields consistently
- [ ] Job result `provider` display name vs DB `provider` id documented (known AWS drift pattern)
- [ ] Consider contract test: electron-contract ↔ preload ↔ main shape parity

### 5.4 Code organization

- [ ] `scripts/providers/aws.mjs` + `digitalocean.mjs` < 500 lines each; shared utils extracted
- [ ] Pure UI logic extracted from `ScopeDropdown` where testable (optional)
- [ ] Comments explain DO-specific concerns (64KiB user_data, floating IP) at decision points

### 5.5 Test maintainability

- [ ] `describe.each(["aws", "digitalocean"])` for shared invariants where applicable
- [ ] DO tests mirror AWS test structure (`providers.aws.test.ts` / `providers.digitalocean.test.ts`)
- [ ] No `.only` / `.skip` / `console.log` left in changed files
- [ ] Test coverage for all new exported helpers

### 5.6 Documentation & ops

- [ ] `docs/remote-vm-cli.md` documents all DO flags
- [ ] Error messages actionable ("set DIGITALOCEAN_ACCESS_TOKEN", not generic fail)
- [ ] CHANGELOG entry drafted (if project uses one)

### 5.7 Maintainability audit execution

- [ ] Run `/simplify` or whole-diff tech-debt pass on changed files
- [ ] Run `/harden-types` on boundary files
- [ ] Grep for `TODO`, `FIXME`, `aws`-only strings that should be generic
- [ ] Peer review checklist completed

### Phase 5 exit criteria

- [ ] Provider addition checklist documented (how to add GCP #3)
- [ ] All 5.1–5.6 items satisfied
- [ ] `pnpm check-pr-readiness` (or equivalent gauntlet) passes

---

## Appendix A: CRUD Surface Checklist (DO must work on all)

| Surface | File | DO work needed |
|---------|------|----------------|
| Create (dropdown) | `ScopeDropdown.tsx:1132` | Provider passed to create flow |
| Create dialog | `ProjectSandboxDialog.tsx` | Provider picker + DO fields |
| Create orchestrator | `project-sandbox-create.ts` | `startDeploy({ provider: "digitalocean" })` |
| List / switch | `ScopeDropdown.tsx` | Subtitle, reconcile, lifecycle |
| Config panel | `SandboxConfigPanel.tsx` | Logs, pause hint, destroy |
| Pause / resume / destroy | `ScopeDropdown`, `SandboxConfigPanel` | IPC → CLI DO branches |
| Optimistic cache | `optimistic-sandbox.ts` | Labels, provisioning status |
| Project scope filter | `project-scoped-sandboxes.ts` | Include DO sandboxes |
| API read | `sandboxes.controller.ts` | Automatic if `remote_config` set |

---

## Appendix B: TDD Test Matrix (write before implement)

| Test file | New cases for DO |
|-----------|------------------|
| `providers.digitalocean.test.ts` | State maps, arg builders, preflight, firewall, missing errors |
| `remote-vm-script.test.ts` | Registry routing, shared SQLite helpers |
| `optimistic-sandbox.test.ts` | DO label, deploy job placeholder |
| `project-scoped-sandboxes.test.ts` | DO visible on project screen |
| `activate-sandbox-scope.test.ts` | DO runtime scope |
| `sandboxes-api.test.ts` | DO public view shape |
| `remote-vm-deploy.test.ts` | DO error extraction |

---

## Appendix C: Risk Register

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| `user_data` exceeds 64 KiB | Medium | Golden snapshot in v2; size test in CI |
| New public IP on resume | High | Document; floating IP in v2 |
| Legacy `digitalocean` rows collide | Low | New provider uses same id string; destroy is row-only safe |
| Contract drift (3 type copies) | Medium | Phase 5.2 single-source import |
| Scope dropdown flicker on delete | Medium | Reuse `destroyingIdsRef` pattern |
| DO API rate limit during poll | Low | TTL + in-flight guards already exist |

---

## Appendix D: Suggested Git / PR Strategy

Work in small PRs aligned to Phase 2 sub-phases:

1. **PR1:** Provider primitives + tests (2.1) — no UI changes
2. **PR2:** Registry refactor + AWS extraction (2.2)
3. **PR3:** Types + Electron + optimistic cache (2.3)
4. **PR4:** Scoping + API tests (2.4)
5. **PR5:** Create flow + lifecycle UI (2.5–2.6)
6. **PR6:** Provider picker UI (2.7, if in scope)
7. **PR7:** Docs + audit fixes (Phases 3–5)

Each PR: `pnpm typecheck && pnpm lint && pnpm test` green before merge.

---

## Progress Log

| Date | Phase | Notes |
|------|-------|-------|
| 2026-06-08 | Phase 1 | Exploration complete via codebase audit; plan authored |
| | Phase 2 | |
| | Phase 3 | |
| | Phase 4 | |
| | Phase 5 | |

---

## Findings Log (Phases 3–5)

_Record security, performance, and maintainability findings here as you complete audit phases._

### Security

_None yet._

### Performance

_None yet._

### Maintainability

_None yet._
