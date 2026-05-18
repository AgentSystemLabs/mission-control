# Hosted SaaS Launch Checklist

Last audited: 2026-05-17

This checklist tracks the remaining work to launch Mission Control as a hosted
browser SaaS using Academy-managed auth/billing, Postgres, and Daytona. It is
the launch tracker, not just a technical inventory. Do not treat the hosted
product as launch-ready until every P0 item and every launch acceptance
criterion is complete with evidence.

## Scope

In scope:

- Browser-hosted Mission Control with Academy as the login and billing source
  of truth.
- Lightweight Mission Control hosted sessions created from Academy-issued
  proof.
- Hosted Postgres persistence for projects, tasks, groups, user terminals,
  hook tokens, cleanup jobs, and entitlements.
- Daytona-backed remote terminals and agent sessions.
- Academy-managed purchase/subscription entitlement for hosted remote runtime.
- Production migration, backup, restore, observability, support, and runbook
  readiness.

Out of scope unless it blocks the hosted launch:

- Electron packaging, notarization, and desktop auto-update work.
- Desktop-only local SQLite behavior.
- Desktop license distribution.

## Completion Rules

- A checkbox is complete only when the implementation exists, is deployed or
  configured in the intended environment, and has explicit evidence.
- Local-only implementation is not enough for a production checklist item that
  names production, live Daytona, Academy billing, or customer operations.
- Tests are evidence only when they cover the named behavior. Unit tests do not
  replace live Daytona validation, Academy entitlement sync replay, or restore
  drills.
- Every completed item should have one of: merged PR, command output, staging
  URL, dashboard link, incident/runbook link, or captured manual test notes.

## Current Baseline

| Area | Status | Evidence in repo |
| --- | --- | --- |
| Better Auth sign-in gate | Removed from hosted Mission Control | `better-auth` removed from `package.json`; `src/server/auth-instance.ts` and `src/lib/auth-client.ts` deleted; `src/components/views/AuthGate.tsx` now uses Academy handoff |
| Hosted Postgres services | Implemented locally | `src/server/hosted-pg.ts`, `src/server/services/hosted-*.ts`, `src/server/services/entitlements.ts` |
| Local Postgres dev stack | Implemented locally | `docker-compose.yml`, `docker/postgres/init`, `docker/postgres/migrations` |
| Electron vs web runtime split | Implemented locally | `src/lib/runtime.ts`, `src/shared/runtime.ts` |
| Daytona remote PTY path | Implemented locally; needs live validation | `src/server/controllers/remote-pty.controller.ts`, `src/server/services/daytona-remote-pty.ts` |
| Remote PTY stream/replay/write/resize/kill endpoints | Implemented locally; needs browser and live validation | `src/lib/api.ts`, `src/components/views/TerminalPane.tsx`, `src/components/views/UserTerminalPane.tsx` |
| Hosted agent hook callbacks | Implemented locally; needs public HTTPS validation | `src/server/services/remote-agent-hooks.ts`, `src/server/controllers/hooks.controller.ts` |
| Remote runtime entitlement gate | Implemented locally with Academy writer | `src/server/services/academy-auth.ts` updates `subscriptionEntitlement`; `src/server/services/entitlements.ts` gates Daytona |
| Academy billing source | Exists in `../academy`; exchange endpoint added | Academy has Better Auth, Stripe checkout, `/api/stripe/webhook`, `app_purchase`, `app_subscription`, `getUserEntitlementsUseCase`, and `/api/mission-control/entitlements/exchange` |
| Cross-app entitlement sync | Implemented foundation; needs live/staging validation | Mission Control `/api/academy-auth/*`; Academy `/api/mission-control/authorize` and `/api/mission-control/entitlements/exchange` |
| Academy auth-code replay protection | Implemented locally | Academy rejects reused hosted auth codes within the code TTL |
| Academy account link | Implemented locally | `academyAccountLink` stores `academyUserId`, email, last sync time, and Academy entitlement version |
| Mission Control Stripe integration | Removed/absent | No Stripe dependency, env var, route, or webhook processing exists in Mission Control |
| Hosted health check | Implemented locally | `GET /api/healthz` returns API and optional database health before origin/bearer auth |
| Local migration validation | Passed on Postgres 17 | `POSTGRES_PORT=55432 docker compose -p mission-control-migration-check run --rm postgres-migrate` |
| Entitlement dedupe restore | Tested locally on Postgres 17 | `docker/postgres/recovery/restore-subscription-entitlement-dedupe.sql`; disposable compose project restored synthetic backup row `ent-restore-1` |
| Production hosting | Start command documented; platform not chosen | `pnpm start:hosted`, `scripts/serve-hosted.mjs`, and `docs/hosted-deployment.md` |
| Operations runbooks | Implemented locally | `docs/hosted-operations-runbook.md` covers entitlement sync, entitlement repair, support diagnostics/actions, stuck terminals, cleanup outbox, backup, and recovery |
| Browser E2E coverage | Basic smoke implemented | `playwright.config.ts` and `e2e/hosted-smoke.spec.ts` cover health, protected API rejection, and static asset serving |
| Abuse controls | Implemented locally; needs production edge backing | In-process limits for auth handoff, hook calls, PTY spawn/write, active PTYs, Daytona auto-stop, and remote-runtime kill switch |
| Hosted observability | Implemented locally; needs production log/metrics sink | `src/server/services/hosted-logs.ts`, `src/server/services/hosted-metrics.ts`, and protected `GET /api/metrics` cover request IDs, structured events, PTY counters, hook failures, cleanup failures, and Academy sync failures |
| Hosted CI | Implemented locally | `.github/workflows/hosted-ci.yml` runs typecheck, unit tests, hosted web build, dependency audit, secret scan, browser smoke, and Postgres 17 migrations |
| Support entitlement replay | Implemented locally | Protected `POST /api/support/entitlements/replay` replays validated Academy claims through the same entitlement sync path and writes `hostedAdminAuditLog` |
| Runtime usage reconciliation | Implemented locally | `hostedRuntimeUsage` migration plus `GET /api/support/runtime-usage` and diagnostics rows track Daytona PTY runtime by user/org/project |

## Environment Matrix

Keep `.env.example`, deployment secrets, and runbooks in sync as variables are
added.

| Variable | Required for hosted launch | Production rule |
| --- | --- | --- |
| `DATABASE_URL` | Yes | Use managed Postgres 17 or validated compatible Postgres. Never use local dev credentials. |
| `MC_SESSION_SECRET` | Yes | Mission Control-only secret for signing or encrypting its lightweight hosted session cookie. |
| `MC_SUPPORT_API_TOKEN` | Yes | Separate bearer token for hosted support/admin endpoints. Do not reuse the Electron/local API token. |
| `MC_SESSION_COOKIE_DOMAIN` | Optional | Set only if Mission Control needs a shared parent-domain cookie. Prefer host-only cookies unless there is a clear reason. |
| `MC_SESSION_TTL_MINUTES` | Recommended | Hosted session lifetime after Academy handoff. Keep it shorter than Academy's primary account session. |
| `MC_SESSION_RENEWAL_WINDOW_MINUTES` | Recommended | Window before local Mission Control session expiry where `/api/academy-auth/session` rotates the cookie and extends the local session. |
| `MISSION_CONTROL_PUBLIC_URL` | Yes for hosted agent hooks | Must be an externally reachable HTTPS origin with a public hostname. Localhost, private IPs, and HTTP are rejected. |
| `DAYTONA_API_KEY` | Yes | Use a scoped production key with rotation documented. |
| `DAYTONA_API_URL` | Optional | Set only if using a non-default Daytona API endpoint. |
| `DAYTONA_TARGET` | Optional | Set when Daytona infrastructure requires a specific target. |
| `DAYTONA_SANDBOX_NAME_PREFIX` | Recommended | Use an environment-specific prefix such as `mission-control-prod`. |
| `DAYTONA_AUTO_STOP_MINUTES` | Recommended | Set the production idle cost-control policy explicitly. |
| `MC_REMOTE_RUNTIME_DISABLED` | Recommended | Emergency kill switch for hosted remote runtime starts/writes without taking the app offline. |
| `MC_MAX_ACTIVE_PTYS_PER_USER` | Recommended | Per-user or per-org active remote PTY cap enforced by the web process. |
| `MC_AUTH_RATE_LIMIT_PER_MINUTE` | Recommended | Per-IP Academy handoff throttle. |
| `MC_HOOK_RATE_LIMIT_PER_MINUTE` | Recommended | Per-IP/task hosted hook throttle. |
| `MC_REMOTE_PTY_SPAWN_RATE_LIMIT_PER_MINUTE` | Recommended | Per-user or per-org remote PTY spawn throttle. |
| `MC_REMOTE_PTY_WRITE_RATE_LIMIT_PER_MINUTE` | Recommended | Per-user or per-org per-PTY write throttle. |
| `MC_REMOTE_PTY_OUTPUT_BUFFER_BYTES` | Recommended | Per-PTY retained output replay buffer cap. Defaults to 1 MB to support reconnects without unbounded in-memory output retention. |
| `MC_MAX_PROJECTS_PER_USER` | Recommended | Default hosted project cap per user or org scope. |
| `MC_MAX_TASKS_PER_USER` | Recommended | Default hosted task cap per user or org scope. |
| `MC_MAX_USER_TERMINALS_PER_USER` | Recommended | Default hosted user-terminal cap per user or org scope. |
| `MC_MAX_COMPUTE_SECONDS_PER_USER` | Recommended | Rolling Daytona runtime seconds cap per user or org scope. |
| `MC_COMPUTE_LIMIT_WINDOW_DAYS` | Recommended | Rolling window for hosted compute usage enforcement and usage messaging. |
| `MC_PLAN_LIMITS_JSON` | Recommended | Academy `sourceTier`-specific overrides for project, task, user-terminal, and compute caps. |
| `MC_BLOCKED_HOSTED_USER_IDS` | Recommended | Comma-separated emergency deny list for Mission Control hosted user IDs. |
| `MC_BLOCKED_ACADEMY_USER_IDS` | Recommended | Comma-separated emergency deny list for Academy source user IDs. |
| `MC_BLOCKED_ORGANIZATION_IDS` | Recommended | Comma-separated emergency deny list for org-scoped hosted runtime. |
| `MC_ALERT_WEBHOOK_URL` | Recommended | Optional webhook target for hosted alert events. Structured logs are still emitted when unset. |
| `MC_ALERT_DEDUP_WINDOW_MINUTES` | Recommended | Alert dedupe window for repeated alert events. |
| `MC_ALERT_DAYTONA_FAILURES` | Recommended | Remote PTY/Daytona failure counter threshold before an alert is emitted. |
| `MC_ALERT_CLEANUP_FAILURES` | Recommended | Cleanup failure counter threshold before an alert is emitted. |
| `MC_ALERT_CLEANUP_OUTBOX_ROWS` | Recommended | Number of stuck cleanup outbox rows that triggers an alert. |
| `MC_ALERT_CLEANUP_OUTBOX_ATTEMPTS` | Recommended | Failed cleanup attempts required before a cleanup row is considered stuck. |
| `MC_ALERT_ACADEMY_SYNC_FAILURES` | Recommended | Academy entitlement sync failure threshold before an alert is emitted. |
| `MC_ALERT_SERVER_EXCEPTIONS` | Recommended | Hosted API server exception threshold before an alert is emitted. |
| `ACADEMY_PUBLIC_URL` | Yes | Canonical HTTPS origin for the Academy app that owns login, checkout, and account billing. |
| `ACADEMY_ACCOUNT_PATH` | Recommended | Academy path for account, purchase, billing portal, invoices, and account management links. |
| `ACADEMY_LOGOUT_PATH` | Recommended | Academy path used after Mission Control logout to clear the Academy source-of-truth session. |
| `ACADEMY_ENTITLEMENTS_API_URL` | Yes | Server-to-server Academy endpoint Mission Control uses to verify hosted access. |
| `ACADEMY_ENTITLEMENTS_API_SECRET` | Yes | Shared secret or client credential for Mission Control to call Academy. Rotate like a production secret. |
| `ACADEMY_AUTH_ISSUER` | Recommended | Stable issuer value for Academy-issued login or entitlement tokens. |
| `ACADEMY_AUTH_JWKS_URL` | Recommended | Public key endpoint if Academy issues signed JWTs to Mission Control. |

## P0: Launch Blockers

### 1. Live Daytona Validation

The Daytona integration is implemented locally but must be proven against real
infrastructure before launch.

- [ ] Create or select the production Daytona account, target, and API key.
- [ ] Configure `DAYTONA_API_KEY` in staging and production.
- [ ] Configure `DAYTONA_API_URL` and `DAYTONA_TARGET` if the selected Daytona
  environment requires them.
- [ ] Configure `MISSION_CONTROL_PUBLIC_URL` to the staging HTTPS origin.
- [ ] Verify `MISSION_CONTROL_PUBLIC_URL` is accepted by
  `getHostedHookApiUrl`: HTTPS, public hostname, no localhost, no private IP.
- [ ] Sign in through Academy and land in hosted Mission Control.
- [ ] Grant that user a temporary entitlement row with
  `remoteRuntimeEnabled = true`.
- [ ] Create a hosted project from the browser.
- [ ] Start a remote user terminal for the hosted project.
- [ ] Verify terminal output streams over SSE.
- [ ] Verify terminal replay returns missed output after reconnect.
- [ ] Verify terminal input reaches the remote PTY.
- [ ] Verify terminal resize changes the remote PTY dimensions.
- [ ] Verify terminal kill emits an exit event and removes the active PTY.
- [ ] Start a Claude Code agent session in Daytona.
- [ ] Start a Codex agent session in Daytona.
- [ ] Start a Cursor CLI agent session in Daytona if Cursor remains a launch
  agent.
- [ ] Verify remote hooks update hosted Postgres task status, preview, line
  count, and session metadata.
- [ ] Verify hook tokens are revoked when a PTY exits normally.
- [ ] Verify hook tokens are revoked when PTY spawn fails after token issue.
- [ ] Verify hook tokens are revoked when a PTY is killed.
- [ ] Delete a hosted task and confirm its task sandbox cleanup is attempted.
- [ ] Delete a hosted project and confirm all project Daytona sandboxes are
  deleted or queued in `hostedCleanupOutbox`.
- [ ] Capture staging notes with user ID, project ID, task ID, sandbox names,
  timestamps, and relevant server logs.

### 2. Academy Subscription Authority

Academy is the billing and account source of truth. Mission Control should not
add its own Stripe checkout, Stripe portal, Stripe webhook stack, or
subscription source of truth. Hosted Mission Control needs a contract that lets
a user who logged in and purchased through `../academy` access the separate
Mission Control web app.

Recommended architecture:

1. Academy owns login, checkout, invoices, billing portal, Stripe webhooks, and
   canonical product entitlement rules.
2. Mission Control redirects unauthenticated hosted users to Academy to sign in
   or purchase.
3. Academy returns a short-lived authorization code or signed token to Mission
   Control after login.
4. Mission Control exchanges that artifact server-to-server with Academy.
5. Academy returns stable identity and entitlement claims.
6. Mission Control stores only the minimum local copy needed to authorize
   hosted runtime access and to keep audit/debug state.

Mission Control local session model:

- Academy issues a short-lived one-time authorization code or signed login
  token after the user authenticates in Academy.
- Mission Control exchanges that proof server-to-server with Academy.
- Mission Control creates an HttpOnly, Secure, SameSite session cookie scoped
  to the Mission Control app.
- Mission Control stores a hashed session token, `academyUserId`, email,
  expiration, and the latest entitlement snapshot.
- Mission Control never stores Academy passwords, OAuth accounts, Stripe
  customers, Stripe subscriptions, or Stripe webhook state.

Required Academy-to-Mission-Control entitlement claims:

- `academyUserId`: stable Academy user ID.
- `email`: current user email for display and support lookup.
- `emailVerified`: whether Academy considers the email verified.
- `missionControlHosted`: whether the user can access hosted Mission Control.
- `remoteRuntimeEnabled`: whether the user can consume Daytona compute.
- `sourceTier`: Academy tier that grants access, such as
  `mission_control_pro`, `academy`, `full_system`, or a future hosted tier.
- `billingStatus`: normalized status such as `active`, `trialing`, `past_due`,
  `canceled`, or `none`.
- `currentPeriodEndsAt` or `accessEndsAt`: nullable ISO timestamp.
- `issuedAt` and `expiresAt`: token/response freshness bounds.

Checklist:

- [ ] Confirm which Academy products grant hosted Mission Control access.
- [ ] Confirm whether existing one-time tiers (`mission_control_pro`,
  `academy`, `full_system`) should grant hosted compute or whether hosted
  compute requires a new recurring tier.
- [ ] Decide whether Operators subscription access grants hosted Mission
  Control access, remote runtime access, or neither.
- [x] Add an Academy entitlement use case specifically for hosted Mission
  Control access instead of overloading course/download access.
- [x] Add Academy endpoint for Mission Control entitlement verification.
- [x] Protect the Academy entitlement endpoint with server-to-server auth,
  signed JWT verification, or an authorization-code exchange.
- [x] Add replay/idempotency protection for the Academy authorization-code
  exchange. No Academy-to-Mission-Control push event exists yet.
- [x] Add Mission Control config for Academy origin, entitlement endpoint, and
  credentials.
- [x] Remove Mission Control Stripe assumptions, dependencies, routes, env vars,
  and checklist items from the hosted app.
- [x] Add Mission Control account-link table or columns for `academyUserId`,
  email, last entitlement sync time, and last Academy entitlement version.
- [x] Update Mission Control `subscriptionEntitlement` from Academy claims, not
  from Stripe directly.
- [x] Revoke `remoteRuntimeEnabled` when Academy says hosted access is inactive,
  expired, canceled, or no longer included in the tier.
- [x] Preserve or grant `remoteRuntimeEnabled` when Academy says hosted remote
  runtime is active.
- [x] Add a Mission Control billing/account link that sends users to Academy
  purchase, billing portal, invoices, and account management.
- [x] Add tests for every entitlement transition caused by Academy claims.
- [x] Add tests for stale, forged, expired, replayed, and wrong-audience Academy
  tokens or responses.
- [x] Add a manual Academy entitlement replay command or admin action for
  support.
- [x] Add runbook notes for debugging mismatches between Academy purchase state
  and Mission Control entitlement state.

### 3. Production Postgres Migration And Recovery

Docker Compose includes a local migration runner, but production still needs a
real deploy-time migration process and recovery plan.

- [x] Choose how production migrations run: deploy release phase, CI job, or
  manually approved migration job.
- [x] Ensure only one migration runner can apply migrations at a time.
- [x] Ensure migrations run with `ON_ERROR_STOP=1`.
- [x] Ensure each migration runs transactionally unless a migration explicitly
  cannot.
- [x] Ensure failed migrations fail the deploy.
- [x] Ensure applied migrations are recorded in `hosted_schema_migrations`.
- [x] Verify migrations against a clean Postgres 17 database.
- [x] Verify migrations against a copy or synthetic snapshot with existing
  hosted data.
- [ ] Keep `subscriptionEntitlementDedupeBackup` through launch.
- [x] Write restore SQL for entitlement dedupe recovery.
- [x] Test restoring deduped entitlement rows from
  `subscriptionEntitlementDedupeBackup`.
- [ ] Decide what to do with legacy `hostedProject` rows that have no
  `organizationId` and no `ownerUserId`.
- [ ] Replace the placeholder `migration-unscoped-owner` path with a real admin
  claim, owner-mapping process, or documented no-legacy-data decision.
- [x] Document pre-migration backup commands.
- [x] Document restore commands.
- [x] Document rollback behavior for application deploys when migrations cannot
  be rolled back.

Local migration verification command:

```bash
docker compose up -d postgres
docker compose run --rm postgres-migrate
```

### 4. Production Hosting

The web runtime still needs an actual deployment target and production process.

- [ ] Pick hosting platform.
- [x] Add a production server start command for the hosted web app.
- [x] Configure production build for the hosted browser/server runtime.
- [x] Confirm whether production should run `pnpm build:web` or full
  `pnpm build`.
- [x] Configure Node 24 or the runtime version required by `package.json`.
- [x] Configure install with `pnpm install --frozen-lockfile`.
- [ ] Configure HTTPS custom domain.
- [ ] Configure `DATABASE_URL`.
- [ ] Configure `MC_SESSION_SECRET`.
- [ ] Configure `MC_SUPPORT_API_TOKEN`.
- [ ] Configure `MC_SESSION_COOKIE_DOMAIN` if needed.
- [ ] Configure `MC_SESSION_TTL_MINUTES`.
- [ ] Configure `MISSION_CONTROL_PUBLIC_URL`.
- [ ] Configure `DAYTONA_API_KEY`.
- [ ] Configure optional Daytona variables when required.
- [ ] Configure Academy integration variables and credentials.
- [x] Add health check endpoint or platform health check configuration.
- [ ] Configure log retention.
- [x] Configure deploy rollback.
- [x] Verify the app works without Electron APIs in the browser.
- [ ] Verify static assets, route loading, server routes, and SSE endpoints work
  behind the selected platform/proxy.

### 5. Auth Productization

Better Auth has been removed from hosted Mission Control. Academy owns account
login, password/OAuth/magic-link flows, email verification, billing, and account
settings. Mission Control only needs to accept Academy-issued proof and create a
lightweight local session for its own app.

- [x] Remove Better Auth from Mission Control hosted auth flow.
- [x] Remove Mission Control Better Auth server instance, client, route wiring,
  env vars, and production setup requirements.
- [x] Remove Better Auth dependencies from Mission Control if no desktop or
  hosted runtime path still needs them.
- [x] Remove Mission Control auth tables created only for Better Auth if they
  are not needed by the lightweight hosted session model.
- [x] Confirm Mission Control has no Stripe dependency, Stripe routes, Stripe
  env vars, or Stripe webhook processing.
- [x] Decide the cross-app auth handoff: Academy authorization-code exchange or
  Academy-issued signed JWT. Prefer one-time auth code exchange for browser
  login.
- [x] Prefer a server-side exchange over trusting browser-provided entitlement
  state.
- [x] Add Mission Control hosted session table with hashed session token,
  `academyUserId`, email, expiration, created time, and revoked time.
- [x] Add Mission Control session cookie with HttpOnly, Secure, SameSite, and
  production domain settings.
- [x] Add session rotation or renewal policy.
- [x] Add session revocation on logout.
- [x] Ensure Mission Control user IDs cannot collide with Academy user IDs.
- [x] Store `academyUserId` as the stable external subject for hosted users.
- [x] Define sign-in redirect from Mission Control to Academy.
- [x] Define post-login callback from Academy back to Mission Control.
- [x] Define post-purchase callback from Academy back to Mission Control.
- [x] Add logout behavior that clears the Mission Control session and provides
  a clear path to sign out of Academy.
- [x] Add account settings/billing links that route to Academy.
- [x] Decide and document Academy session expiration policy for Mission Control
  handoff.
- [x] Add organization/team invitation flow only if org-scoped hosted projects
  are part of launch.
- [x] Confirm whether launch entitlements are user-scoped, org-scoped, or both.
- [x] Add tests for auth-required hosted API routes.
- [x] Add tests that Electron bearer-token auth, Mission Control hosted session
  cookies, Academy handoff tokens, and hook tokens cannot replace each other in
  the wrong runtime.

## P1: Required Before Taking Real Customers

### 6. Hosted Onboarding

Users need a clear first-run path for the hosted product.

- [x] Add onboarding for first project creation.
- [x] Explain in product copy that hosted terminals and agents run in Daytona.
- [x] Show Academy entitlement or billing state when remote runtime is
  unavailable.
- [x] Add useful empty states for no projects.
- [x] Add useful empty states for no user terminals.
- [x] Add useful empty states for no tasks.
- [x] Add clear error messages for Daytona setup failures.
- [x] Add clear error messages for entitlement failures.
- [x] Add retry affordances for failed terminal/session starts.
- [x] Add a support path when remote runtime repeatedly fails.

### 7. End-To-End Tests

Current tests cover server logic and a basic hosted browser smoke, but not full
Academy sign-in, project creation, or remote Daytona flows.

- [x] Add Playwright configuration.
- [x] Add browser test server setup.
- [x] Add hosted sign-up/sign-in smoke test.
- [x] Add auth-required route test in the browser.
- [x] Add hosted project creation test.
- [x] Add hosted user terminal creation test with mocked Daytona.
- [x] Add remote agent task creation flow test with mocked Daytona and hook
  callback.
- [x] Add Academy-entitlement-gated remote runtime test.
- [x] Add no-entitlement remote runtime denial test.
- [x] Add cleanup outbox test for deletion failure/retry.
- [x] Decide which tests run in CI and which live smoke tests run manually
  against staging.

### 8. Observability

Hosted runtime failures need to be diagnosable without local reproduction.

- [x] Add structured logs around auth decisions.
- [x] Add structured logs around entitlement decisions.
- [x] Add structured logs around PTY spawn, start, output stream errors, kill,
  and exit.
- [x] Add structured logs around hook token issue/revocation.
- [x] Add structured logs around hook validation failures.
- [x] Add structured logs around cleanup outbox enqueue and retry.
- [x] Add request IDs or correlation IDs through remote PTY and hook flows.
- [x] Add metrics for PTY starts.
- [x] Add metrics for PTY failures.
- [x] Add metrics for active sessions.
- [x] Add metrics for hook failures.
- [x] Add metrics for cleanup failures.
- [x] Add metrics for Academy entitlement sync failures.
- [x] Add alerts for repeated Daytona failures.
- [x] Add alerts for stuck `hostedCleanupOutbox` rows.
- [x] Add alerts for repeated Academy entitlement sync failures.
- [x] Add error reporting for server exceptions.

### 9. Abuse Controls

Remote compute costs money and can be abused.

- [x] Add per-user active PTY limit.
- [x] Add per-org active PTY limit if orgs are enabled.
- [x] Add rate limits for PTY spawn.
- [x] Add rate limits for terminal write.
- [x] Add rate limits for hook calls.
- [x] Add rate limits for auth attempts.
- [x] Add rate limits for Academy auth handoff and entitlement sync endpoints.
- [x] Add sandbox lifetime limits.
- [x] Add idle timeout policy.
- [x] Add maximum retained output buffer policy and verify the existing
  in-memory ring buffer is enough for launch.
- [x] Add max projects per plan.
- [x] Add max tasks per plan.
- [x] Add max user terminals per plan.
- [x] Add admin override or kill switch for abusive accounts.
- [x] Add emergency global remote-runtime disable switch.

### 10. Admin And Support Tools

Support needs a way to debug customer issues without manually querying
production.

- [x] Add admin view for users.
- [x] Add admin view for organizations if orgs are enabled.
- [x] Add admin view for entitlements.
- [x] Add admin view for projects.
- [x] Add admin view for active remote sessions.
- [x] Add admin view for cleanup outbox rows.
- [x] Add manual entitlement adjustment tool.
- [x] Add manual remote cleanup/retry action.
- [x] Add user impersonation or support-safe diagnostics if needed.
- [x] Add audit logs for admin actions.
- [x] Add support notes explaining what staff can and cannot inspect inside a
  customer's remote workspace.

## P2: Polish And Scale

### 11. Product UX Polish

- [x] Add account/billing page or redirect surface that routes to Academy.
- [x] Add plan comparison page.
- [x] Add account/org switcher if orgs are enabled. User-scoped launch is
  selected, so org switching is not part of launch scope.
- [x] Improve hosted-specific error copy.
- [x] Add loading states across hosted project, task, and terminal surfaces.
- [x] Add empty states across hosted project, task, and terminal surfaces.
- [x] Add error states across hosted project, task, and terminal surfaces.
- [x] Add user-visible status when a Daytona sandbox is starting.
- [x] Add user-visible status when a Daytona sandbox is reconnecting.
- [x] Add user-visible status when a Daytona sandbox is cleaning up.

### 12. Documentation And Runbooks

- [x] Update README for local hosted development with Postgres.
- [x] Document required hosted environment variables.
- [x] Document Daytona setup.
- [x] Document Academy entitlement integration setup.
- [x] Document migration process.
- [x] Document backup and restore process.
- [x] Document production deploy process.
- [x] Document production rollback process.
- [x] Document runbook for stuck terminals.
- [x] Document runbook for stuck cleanup jobs.
- [x] Document runbook for Academy entitlement sync failures.
- [x] Document runbook for entitlement repair.
- [x] Document runbook for data recovery.

### 13. CI/CD

- [x] Add CI job for typecheck.
- [x] Add CI job for unit tests.
- [x] Add CI job for browser tests.
- [x] Add CI job for production build.
- [x] Add migration validation against Postgres 17.
- [x] Add lint job once the repo has lint tooling installed and passing.
- [x] Add secret scanning.
- [x] Add dependency audit policy.
- [x] Add release checklist or required checks before production deploy.

### 14. Cost Controls

- [x] Track Daytona sandbox runtime/cost basis per user/org.
- [x] Enforce plan-specific compute limits.
- [x] Add internal dashboard for usage.
- [x] Add reconciliation between Academy entitlement state and actual Daytona
  usage.
- [x] Decide what happens when a user exceeds limits.
- [x] Add customer-facing usage messaging before limits are hit.

## Manual Hosted Smoke Script

Run this against staging before production launch and after any high-risk
runtime change.

1. Deploy the current build to staging.
2. Confirm staging uses a managed Postgres database or a clean Postgres 17
   instance.
3. Run production-equivalent migrations.
4. Configure all required hosted environment variables.
5. Sign up a new browser user.
6. Grant access through Academy purchase/subscription state. Until the Academy
   integration is implemented, insert a temporary staging entitlement and record
   the SQL.
7. Create a hosted project.
8. Start a remote user terminal.
9. Run a simple shell command and verify output appears.
10. Reload the browser and verify output replay/reconnect.
11. Resize the terminal and verify it remains usable.
12. Kill the terminal and verify the UI receives an exit event.
13. Start a remote agent task.
14. Submit a prompt that causes a status transition.
15. Verify hosted hooks update the task in Postgres and the browser UI.
16. Remove entitlement and verify remote runtime creation is denied.
17. Delete the task/project and verify Daytona cleanup or cleanup outbox retry.
18. Save smoke notes with environment, user, project, task, sandbox IDs, and
    log links.

## Release Verification Commands

These commands are not a substitute for live validation, but they are required
local and CI gates before launch.

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm build:web
pnpm build
docker compose up -d postgres
docker compose run --rm postgres-migrate
pnpm test:e2e
```

Expected launch state:

- [x] `pnpm typecheck` passes.
- [x] `pnpm test` passes.
- [x] `pnpm build:web` passes.
- [x] `pnpm build` passes or hosted deployment explicitly documents why only
  `pnpm build:web` is required.
- [x] Local Postgres migrations pass on Postgres 17.
- [x] Browser E2E tests pass.
- [ ] Live Daytona staging smoke passes.
- [ ] Academy entitlement sync replay passes.
- [ ] Backup and restore drill passes.

## Launch Acceptance Criteria

Mission Control is ready for hosted SaaS launch only when all of these are
true:

- [ ] A new user can sign up through Academy and enter hosted Mission Control.
- [ ] A new user can buy or activate the required product in Academy.
- [ ] A new user can create a hosted project.
- [ ] A new user can run a remote terminal without Electron.
- [ ] A remote agent session can run in Daytona.
- [ ] A remote agent session can update task state through hosted hooks.
- [ ] A user without an authenticated hosted session cannot access hosted API
  data.
- [ ] A user without an active entitlement cannot consume Daytona compute.
- [ ] Academy entitlement sync correctly grants, revokes, and updates Mission
  Control entitlements.
- [ ] Production migrations are repeatable, transactional where possible,
  backed up, and tested against Postgres 17.
- [ ] Entitlement dedupe backup and restore behavior is documented and tested.
- [ ] Legacy hosted data ownership is resolved or proven absent before launch.
- [ ] Remote resources are cleaned up or retried durably.
- [ ] Errors are observable enough to debug without local reproduction.
- [ ] E2E tests cover the hosted happy path.
- [ ] E2E tests cover auth-required and entitlement-denied failure paths.
- [ ] Required runbooks exist for deploy, rollback, Academy entitlement sync,
  cleanup, and data recovery.
- [x] Support can inspect entitlement/session/cleanup state without direct
  production database access.
- [ ] Abuse limits prevent one account from creating unbounded Daytona cost.

## Open Decisions

- [x] Academy-to-Mission-Control auth handoff mechanism.
- [x] Academy entitlement API shape.
- [ ] Academy products that grant hosted Mission Control access.
- [ ] Whether hosted compute is included in existing one-time products or needs
  a new recurring Academy-managed product.
- [ ] Academy-managed hosted trial length, if hosted trials exist.
- [ ] Whether Academy-managed hosted trials require a payment method.
- [ ] Whether Academy `past_due` status has a hosted compute grace period.
- [x] User-scoped launch, org-scoped launch, or both.
- [ ] Production hosting platform.
- [x] Production migration runner.
- [ ] Backup provider and restore target.
- [x] Whether Mission Control keeps a local hosted session table or uses signed
  encrypted cookies only.
- [x] Daytona sandbox lifetime and idle timeout policy.
- [x] Per-plan project, task, terminal, and compute limits.

## Remaining External Launch Blockers

The unchecked items above are intentionally still open because they require
live credentials, a selected production platform, staging/prod configuration,
or business decisions outside this repository. Do not mark them complete from
local tests alone.

- Daytona production account/API key/target selection and live staging smoke.
- Academy product, hosted-compute, trial, payment-method, and past-due policy
  decisions.
- Production hosting platform, HTTPS domain, secrets, log retention, and proxy
  verification.
- Backup provider selection plus a real backup/restore drill.
- Legacy hosted data ownership decision or proof that no legacy unscoped data
  exists before launch.
