# Hosted Deployment

Mission Control hosted SaaS uses the web/TanStack Start build only. The
Electron package build is for desktop releases and is not required for the
hosted web app.

## Local Hosted Development

Start Postgres and apply hosted migrations:

```bash
docker compose up -d postgres
docker compose run --rm postgres-migrate
```

If local port `5432` is already in use, choose another host port:

```bash
POSTGRES_PORT=55432 docker compose up -d postgres
POSTGRES_PORT=55432 docker compose run --rm postgres-migrate
DATABASE_URL=postgres://mission_control:mission_control_dev@localhost:55432/mission_control pnpm dev:server
```

Hosted mode is enabled when `DATABASE_URL` is set. Without `DATABASE_URL`, the
app runs in desktop/local persistence mode.

## Required Environment

Set these variables before starting the hosted web app:

```bash
DATABASE_URL=
MC_SESSION_SECRET=
MC_SUPPORT_API_TOKEN=
MISSION_CONTROL_PUBLIC_URL=
DAYTONA_API_KEY=
ACADEMY_PUBLIC_URL=
ACADEMY_ENTITLEMENTS_API_URL=
ACADEMY_ENTITLEMENTS_API_SECRET=
```

Recommended variables:

```bash
MC_SESSION_TTL_MINUTES=10080
MC_SESSION_RENEWAL_WINDOW_MINUTES=1440
MC_SESSION_COOKIE_DOMAIN=
ACADEMY_MISSION_CONTROL_AUTHORIZE_PATH=/api/mission-control/authorize
ACADEMY_ACCOUNT_PATH=/dashboard
ACADEMY_LOGOUT_PATH=/api/logout
DAYTONA_API_URL=
DAYTONA_TARGET=
DAYTONA_SNAPSHOT=mission-control-cloud-agents
DAYTONA_SANDBOX_NAME_PREFIX=mission-control-prod
DAYTONA_AUTO_STOP_MINUTES=15
MC_REMOTE_RUNTIME_DISABLED=
MC_MAX_ACTIVE_PTYS_PER_USER=5
MC_AUTH_RATE_LIMIT_PER_MINUTE=30
MC_HOOK_RATE_LIMIT_PER_MINUTE=120
MC_REMOTE_PTY_SPAWN_RATE_LIMIT_PER_MINUTE=10
MC_REMOTE_PTY_WRITE_RATE_LIMIT_PER_MINUTE=600
MC_REMOTE_PTY_OUTPUT_BUFFER_BYTES=1000000
MC_MAX_PROJECTS_PER_USER=25
MC_MAX_TASKS_PER_USER=250
MC_MAX_USER_TERMINALS_PER_USER=25
MC_MAX_COMPUTE_SECONDS_PER_USER=144000
MC_COMPUTE_LIMIT_WINDOW_DAYS=30
MC_PLAN_LIMITS_JSON=
MC_BLOCKED_HOSTED_USER_IDS=
MC_BLOCKED_ACADEMY_USER_IDS=
MC_BLOCKED_ORGANIZATION_IDS=
MC_ALERT_WEBHOOK_URL=
MC_ALERT_DEDUP_WINDOW_MINUTES=15
MC_ALERT_DAYTONA_FAILURES=5
MC_ALERT_CLEANUP_FAILURES=5
MC_ALERT_CLEANUP_OUTBOX_ROWS=1
MC_ALERT_CLEANUP_OUTBOX_ATTEMPTS=3
MC_ALERT_ACADEMY_SYNC_FAILURES=5
MC_ALERT_SERVER_EXCEPTIONS=1
```

`MISSION_CONTROL_PUBLIC_URL` must be the externally reachable HTTPS origin used
by Daytona hook callbacks. Do not set it to localhost in staging or production.

Set `MC_REMOTE_RUNTIME_DISABLED=true` as an emergency kill switch to block new
hosted remote runtime operations without taking the web app offline.

Set `MC_REMOTE_PTY_OUTPUT_BUFFER_BYTES` to cap retained in-memory PTY output
per active remote terminal. The default is `1000000` bytes, enough for short
browser reconnects and replay without retaining unbounded customer output in
the web process.

Set the `MC_MAX_*_PER_USER` variables for default hosted resource caps and
`MC_MAX_COMPUTE_SECONDS_PER_USER` for rolling Daytona runtime seconds. Use
`MC_COMPUTE_LIMIT_WINDOW_DAYS` to control the usage window. Use
`MC_PLAN_LIMITS_JSON` for Academy `sourceTier`-specific overrides:

```json
{
  "mission_control_pro": { "projects": 10, "tasks": 100, "userTerminals": 10, "computeSeconds": 36000 },
  "operators": { "projects": 50, "tasks": 500, "userTerminals": 50, "computeSeconds": 144000 }
}
```

Set `MC_BLOCKED_HOSTED_USER_IDS`, `MC_BLOCKED_ACADEMY_USER_IDS`, or
`MC_BLOCKED_ORGANIZATION_IDS` as comma-separated emergency deny lists for
abusive accounts. Denied accounts keep their local session but cannot start
hosted remote runtime.

Set `MC_ALERT_WEBHOOK_URL` to receive JSON alert events. Alert thresholds are
controlled with `MC_ALERT_DAYTONA_FAILURES`, `MC_ALERT_CLEANUP_FAILURES`,
`MC_ALERT_CLEANUP_OUTBOX_ROWS`, `MC_ALERT_CLEANUP_OUTBOX_ATTEMPTS`,
`MC_ALERT_ACADEMY_SYNC_FAILURES`, and `MC_ALERT_SERVER_EXCEPTIONS`; alerts are
deduplicated for `MC_ALERT_DEDUP_WINDOW_MINUTES`.

## Session Policy

Academy owns the primary account session. Mission Control creates only a local
hosted app session after Academy handoff.

- `MC_SESSION_TTL_MINUTES` controls the maximum Mission Control session
  lifetime after handoff. Keep it shorter than Academy's account session.
- `MC_SESSION_RENEWAL_WINDOW_MINUTES` controls sliding renewal. When the
  browser calls `/api/academy-auth/session` inside this window, Mission Control
  rotates the session token and extends the local session TTL.
- Logout clears the Mission Control session cookie and then redirects the user
  to Academy's `ACADEMY_LOGOUT_PATH` so the Academy account session can be
  cleared by the source-of-truth app.

## Daytona Setup

1. Create separate Daytona API keys for staging and production.
2. Configure `DAYTONA_API_KEY` in each hosted environment. Set
   `DAYTONA_API_URL` and `DAYTONA_TARGET` only when the selected Daytona
   infrastructure requires non-default values.
3. Build the hosted agent snapshot with `pnpm daytona:snapshot`, then set
   `DAYTONA_SNAPSHOT` to the created snapshot name. The default is
   `mission-control-cloud-agents`.
4. Set `DAYTONA_SANDBOX_NAME_PREFIX` to an environment-specific prefix such as
   `mission-control-staging` or `mission-control-prod`.
5. Set `DAYTONA_AUTO_STOP_MINUTES` to the approved idle policy.
6. Set `MISSION_CONTROL_PUBLIC_URL` to the hosted HTTPS origin. Daytona hook
   callbacks reject localhost, private IPs, and non-HTTPS production origins.
7. Keep `MC_REMOTE_RUNTIME_DISABLED=true` until Academy handoff, entitlement
   sync, and live Daytona smoke tests pass in staging.

## Academy Entitlement Integration Setup

1. Deploy Academy at the canonical `HOST_NAME` origin used for login and
   checkout.
2. Configure both apps with the same server-to-server entitlement secret:
   `ACADEMY_ENTITLEMENTS_API_SECRET`.
3. In Mission Control, set `ACADEMY_PUBLIC_URL`,
   `ACADEMY_ENTITLEMENTS_API_URL`, `ACADEMY_ACCOUNT_PATH`, and
   `ACADEMY_LOGOUT_PATH`.
4. In Academy, expose `/api/mission-control/authorize` for browser handoff and
   `/api/mission-control/entitlements/exchange` for Mission Control's
   server-to-server code exchange.
5. Keep Stripe, checkout, invoices, billing portal, and webhook processing in
   Academy. Mission Control stores only the local hosted session, account link,
   and latest entitlement snapshot returned by Academy.
6. Run the Academy hosted-auth unit test and a staging handoff before enabling
   remote runtime for real users.

## Launch Scope

Hosted launch is user-scoped. Mission Control keeps organization columns in the
hosted schema for a future team launch, but `getHostedAuthContext` currently
returns `organizationId: null` for Academy handoff sessions. Do not enable
organization/team invitations for the first hosted launch. Academy entitlement
claims should grant user-scoped hosted access and Mission Control should write
user-scoped `subscriptionEntitlement` rows.

After an Academy purchase, route the user back through the same Mission Control
login handoff rather than adding a separate billing callback in Mission
Control. The post-purchase target should be:

```text
https://mission-control.example.com/api/academy-auth/login
```

That endpoint redirects to Academy, receives a fresh one-time authorization
code, exchanges it server-to-server, and stores the latest entitlement snapshot
locally.

## Build And Start

Hosted deployments should run the web build:

```bash
pnpm install --frozen-lockfile
pnpm build:web
pnpm start:hosted
```

`pnpm start:hosted` serves `dist-server/client` static assets and forwards
application/API requests to `dist-server/server/server.js`. Configure the
listening address with:

```bash
PORT=3000
HOST=0.0.0.0
```

The health endpoint is public and intended for platform health checks:

```bash
curl -fsS https://mission-control.example.com/api/healthz
```

With `DATABASE_URL` set, `/api/healthz` also verifies Postgres connectivity.
Runtime metrics are exposed on the protected API surface:

```bash
curl -fsS \
  -H "Authorization: Bearer $MC_SUPPORT_API_TOKEN" \
  https://mission-control.example.com/api/metrics
```

## Migrations

Production migrations run as a manually approved one-off migration job before
starting new web instances. Do not run migrations from ordinary web dynos or
from more than one deploy job at once.

```bash
docker compose run --rm postgres-migrate
```

The migration runner:

- creates `hosted_schema_migrations` if needed;
- creates and acquires the `hosted_schema_migration_locks` row before applying
  any files, so a second runner exits before it can apply migrations;
- stores a lock owner and clears locks older than two hours before trying to
  acquire a new lock;
- runs with `ON_ERROR_STOP=1`;
- runs each migration file with `--single-transaction`;
- records each applied file after it succeeds;
- exits non-zero when a migration or record step fails.

Production should still use the hosting platform's release-phase lock or CI
environment concurrency for the production environment. If a migration process
is killed hard and leaves a stale `hosted_schema_migration_locks` row newer than
two hours, clear it only after confirming no migration job is running.

## Rollback

Application rollback is image/artifact based:

1. Stop or cancel the current rollout.
2. Start the previously known-good artifact with the same environment.
3. Confirm `/api/healthz` returns `ok`.
4. Sign in through Academy and verify hosted project listing.

Database migrations are forward-only unless a specific migration includes an
explicit recovery procedure. Before production migrations, capture a managed
Postgres backup or snapshot and record the restore target. If a migration
causes data damage, restore the database snapshot into a recovery database,
inspect the affected rows, and copy back only the reviewed repair data.

## Required Checks

Before a hosted production deploy, require these checks to pass on the exact
commit being deployed:

```bash
pnpm typecheck
pnpm test
pnpm build:web
pnpm audit --prod --audit-level high
pnpm scan:secrets
pnpm test:e2e
docker compose up -d postgres
docker compose run --rm postgres-migrate
docker compose down -v
```

The same gates are wired in `.github/workflows/hosted-ci.yml`. The dependency
audit fails on high-or-higher production dependency advisories, and the secret
scan fails on common private key, cloud token, payment token, and API key
patterns.
