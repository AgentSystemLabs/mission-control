# Hosted Operations Runbook

Use this runbook for staging and production support of hosted Mission Control.
Commands assume a Postgres client pointed at the hosted `DATABASE_URL`.

## Quick Health Triage

1. Check the web process:

   ```bash
   curl -fsS "$MISSION_CONTROL_PUBLIC_URL/api/healthz"
   ```

2. Check that Postgres is reachable from the app environment. With
   `DATABASE_URL` set, `/api/healthz` returns `database: "ok"` only after a
   successful `SELECT 1`.
3. Check recent server logs for `[api]`, `[health]`, Daytona SDK errors, and
   Academy entitlement exchange failures.
4. Check the protected hosted metrics endpoint with the support bearer token:

   ```bash
   curl -fsS \
    -H "Authorization: Bearer $MC_SUPPORT_API_TOKEN" \
     "$MISSION_CONTROL_PUBLIC_URL/api/metrics"
   ```

   Watch `remotePtyStarts`, `remotePtyFailures`, `activeRemotePtys`,
   `hookFailures`, `cleanupFailures`, and `academyEntitlementSyncFailures`.
5. Confirm `MC_ALERT_WEBHOOK_URL` is configured in staging/production if the
   hosting platform is not already scraping and alerting on `/api/metrics`.
   Alert events are also written as structured `alert.triggered` logs.

## Academy Entitlement Sync Failures

Mission Control does not own Stripe or Academy billing state. Academy is the
source of truth. Mission Control stores the latest local snapshot in:

- `academyAccountLink`
- `subscriptionEntitlement`
- `hostedSession`

Inspect a user by Academy user ID:

```sql
SELECT *
FROM "academyAccountLink"
WHERE "academyUserId" = '<academy-user-id>';

SELECT e.*
FROM "subscriptionEntitlement" e
JOIN "academyAccountLink" a ON a."userId" = e."userId"
WHERE a."academyUserId" = '<academy-user-id>';

SELECT "id", "userId", "academyUserId", "expiresAt", "revokedAt", "createdAt"
FROM "hostedSession"
WHERE "academyUserId" = '<academy-user-id>'
ORDER BY "createdAt" DESC
LIMIT 20;
```

Support can inspect the same data without direct database access through the
protected diagnostics endpoint, including recent `hostedRuntimeUsage` rows for
Daytona reconciliation:

```bash
curl -fsS \
  -H "Authorization: Bearer $MC_SUPPORT_API_TOKEN" \
  "$MISSION_CONTROL_PUBLIC_URL/api/support/diagnostics?academyUserId=<academy-user-id>"
```

Active remote sessions:

```bash
curl -fsS \
  -H "Authorization: Bearer $MC_SUPPORT_API_TOKEN" \
  "$MISSION_CONTROL_PUBLIC_URL/api/support/remote-sessions"
```

Runtime usage summary for reconciliation:

```bash
curl -fsS \
  -H "Authorization: Bearer $MC_SUPPORT_API_TOKEN" \
  "$MISSION_CONTROL_PUBLIC_URL/api/support/runtime-usage?days=30"
```

Manual entitlement adjustment for support repair:

```bash
curl -fsS \
  -H "Authorization: Bearer $MC_SUPPORT_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "academyUserId": "<academy-user-id>",
    "plan": "paid",
    "status": "active",
    "remoteRuntimeEnabled": true,
    "currentPeriodStartsAt": "2026-05-01T00:00:00.000Z",
    "currentPeriodEndsAt": "2026-06-01T00:00:00.000Z",
    "reason": "support repair after Academy entitlement mismatch"
  }' \
  "$MISSION_CONTROL_PUBLIC_URL/api/support/entitlements/adjust"
```

Manual Academy entitlement replay when Academy has already verified the current
source-of-truth claim and the claim is still inside its `issuedAt` / `expiresAt`
freshness window:

```bash
curl -fsS \
  -H "Authorization: Bearer $MC_SUPPORT_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "claims": {
      "audience": "mission-control",
      "academyUserId": "<academy-user-id>",
      "email": "user@example.com",
      "emailVerified": true,
      "missionControlHosted": true,
      "remoteRuntimeEnabled": true,
      "sourceTier": "mission_control_cloud",
      "billingStatus": "active",
      "currentPeriodStartsAt": "2026-05-01T00:00:00.000Z",
      "currentPeriodEndsAt": "2026-06-01T00:00:00.000Z",
      "accessEndsAt": "2026-06-01T00:00:00.000Z",
      "issuedAt": "2026-05-17T00:00:00.000Z",
      "expiresAt": "2026-05-17T00:05:00.000Z",
      "entitlementVersion": "<academy-entitlement-version>"
    },
    "reason": "support replay after Academy entitlement mismatch"
  }' \
  "$MISSION_CONTROL_PUBLIC_URL/api/support/entitlements/replay"
```

Use replay before manual adjustment when Academy can produce a fresh claim. The
endpoint upserts the same `academyAccountLink` and `subscriptionEntitlement`
snapshot as the browser handoff, but does not create a new hosted session.

Expected grant shape for hosted remote runtime:

- `academyAccountLink."missionControlHosted" = true`
- `academyAccountLink."remoteRuntimeEnabled" = true`
- `subscriptionEntitlement.plan = 'paid'`
- `subscriptionEntitlement.status = 'active'`
- `subscriptionEntitlement."remoteRuntimeEnabled" = true`
- `subscriptionEntitlement."currentPeriodStartsAt"` is the current Academy
  billing period start when available
- `subscriptionEntitlement."currentPeriodEndsAt"` is null or in the future

If Academy shows the user should have access but Mission Control does not:

1. Confirm Academy `/api/mission-control/entitlements/exchange` returns the
   expected claims for a fresh login handoff.
2. Confirm `ACADEMY_ENTITLEMENTS_API_URL` and
   `ACADEMY_ENTITLEMENTS_API_SECRET` match on both apps.
3. Ask the user to sign out of Mission Control and sign in through Academy
   again. The callback upserts `academyAccountLink` and
   `subscriptionEntitlement`.
4. If the user still cannot access remote runtime, compare
   `lastAcademyEntitlementVersion` with the Academy claim's
   `entitlementVersion`.

Do not manually grant production access without a support ticket and an Academy
billing/source-of-truth check.

## Entitlement Repair

Emergency manual repair is allowed only when Academy is verified and a normal
rehandoff is blocked. Record the ticket ID, Academy user ID, operator, before
row, and after row.

Grant a verified active user-scoped entitlement:

```sql
UPDATE "subscriptionEntitlement"
SET "plan" = 'paid',
  "status" = 'active',
  "remoteRuntimeEnabled" = true,
  "currentPeriodStartsAt" = '2026-05-01T00:00:00.000Z',
  "currentPeriodEndsAt" = NULL,
  "trialEndsAt" = NULL,
  "updatedAt" = now()
WHERE "userId" = 'academy:<academy-user-id>'
  AND "organizationId" IS NULL;
```

Revoke a user-scoped entitlement:

```sql
UPDATE "subscriptionEntitlement"
SET "plan" = 'none',
  "status" = 'inactive',
  "remoteRuntimeEnabled" = false,
  "trialEndsAt" = NULL,
  "currentPeriodStartsAt" = NULL,
  "currentPeriodEndsAt" = NULL,
  "updatedAt" = now()
WHERE "userId" = 'academy:<academy-user-id>'
  AND "organizationId" IS NULL;
```

Force reauthentication after entitlement repair:

```sql
UPDATE "hostedSession"
SET "revokedAt" = now(), "updatedAt" = now()
WHERE "academyUserId" = '<academy-user-id>'
  AND "revokedAt" IS NULL;
```

## Stuck Remote Terminals

Remote PTYs are in-memory per web process. A terminal can be stuck because the
Daytona sandbox is still starting, the SSE stream is disconnected, a hook token
expired, or the web process no longer owns the in-memory PTY.

Support staff may inspect Mission Control metadata such as user ID, Academy
user ID, project ID, task ID, task status, sandbox ID/name, timestamps, hook
token status, cleanup status, and error messages. Do not open a customer's
remote workspace shell, read files, run commands, or copy terminal output unless
the customer has explicitly approved that action in the support ticket.

Inspect the project/task:

```sql
SELECT "id", "ownerUserId", "remoteSandboxId", "remoteProvider", "runtime", "updatedAt"
FROM "hostedProject"
WHERE "id" = '<project-id>';

SELECT "id", "projectId", "status", "preview", "lines", "updatedAt"
FROM "hostedTask"
WHERE "projectId" = '<project-id>'
ORDER BY "updatedAt" DESC;
```

Inspect hook tokens for a task:

```sql
SELECT "id", "taskId", "expiresAt", "revokedAt", "createdAt"
FROM "hookToken"
WHERE "taskId" = '<task-id>'
ORDER BY "createdAt" DESC;
```

If a terminal is stuck but the task is not actively running, set the task to
`disconnected` and ask the user to start a new session:

```sql
UPDATE "hostedTask"
SET "status" = 'disconnected',
  "preview" = 'Remote session disconnected. Start a new session to continue.',
  "updatedAt" = now()
WHERE "id" = '<task-id>'
  AND "status" = 'running';
```

Use Daytona labels to find matching sandboxes:

- `app=mission-control`
- `runtime=web-daytona`
- `projectId=<project-id>`
- `taskId=<task-id>` for agent task sandboxes

Prefer Daytona delete over stop when the user requested task/project deletion.

## Stuck Cleanup Jobs

Project deletion queues cleanup in `hostedCleanupOutbox` when Daytona deletion
fails. The web process schedules a worker every 60 seconds.

Inspect stuck rows:

```sql
SELECT "id", "kind", "status", "attempts", "scope", "payload", "lastError", "updatedAt"
FROM "hostedCleanupOutbox"
WHERE "status" IN ('pending', 'failed', 'processing')
ORDER BY "updatedAt" ASC;
```

Rows in `processing` for more than 15 minutes are eligible for retry by the
worker. If the associated `hostedProject` still exists, cleanup is intentionally
deferred.

After manually deleting the Daytona sandbox and project-scoped sandboxes, mark
the row done:

```sql
UPDATE "hostedCleanupOutbox"
SET "status" = 'done',
  "lastError" = NULL,
  "updatedAt" = now()
WHERE "id" = '<outbox-id>';
```

To retry a row immediately:

```sql
UPDATE "hostedCleanupOutbox"
SET "status" = 'failed',
  "updatedAt" = now() - interval '16 minutes'
WHERE "id" = '<outbox-id>';
```

Or use the protected support endpoint, which also records an admin audit row:

```bash
curl -fsS \
  -H "Authorization: Bearer $MC_SUPPORT_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"id":"<outbox-id>","reason":"retry after manual Daytona check"}' \
  "$MISSION_CONTROL_PUBLIC_URL/api/support/cleanup-outbox/retry"
```

## Backup And Restore

Before production migrations or bulk repair, take a managed Postgres snapshot.
Also capture logical backups for targeted restore:

```bash
pg_dump "$DATABASE_URL" \
  --format=custom \
  --file="mission-control-$(date +%Y%m%d%H%M%S).dump"
```

Restore to a recovery database first, never directly over production:

```bash
pg_restore \
  --dbname "$RECOVERY_DATABASE_URL" \
  --clean \
  --if-exists \
  mission-control-YYYYMMDDHHMMSS.dump
```

Use the recovery database to inspect affected rows, then copy back only the
reviewed records needed for repair. For entitlement dedupe recovery, inspect
`subscriptionEntitlementDedupeBackup` before inserting any rows back into
`subscriptionEntitlement`.

For entitlement dedupe recovery, run the reviewed restore script against a
recovery database first:

```bash
psql "$RECOVERY_DATABASE_URL" \
  -f docker/postgres/recovery/restore-subscription-entitlement-dedupe.sql
```

The script restores only archived rows whose user/org scope no longer has a
current entitlement, avoiding partial unique-index conflicts.

## Escalation Checklist

Escalate before manual repair when:

- Academy and Mission Control disagree on billing state.
- A Daytona sandbox cannot be deleted from the dashboard/API.
- More than one customer is affected.
- A migration applied successfully but produced unexpected data.
- A restore from managed backup is required.
