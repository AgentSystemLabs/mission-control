BEGIN;

-- Restore deduped entitlement rows only into scopes that no longer have a
-- current entitlement. Review the SELECT output before committing this in a
-- recovery database, then replay only the reviewed rows in production.
CREATE TEMP TABLE "_subscription_entitlement_restore_candidates" AS
SELECT
  b."id",
  b."organizationId",
  b."userId",
  b."plan",
  b."status",
  b."remoteRuntimeEnabled",
  b."trialEndsAt",
  b."currentPeriodStartsAt",
  b."currentPeriodEndsAt",
  b."createdAt",
  b."updatedAt",
  b."archivedAt",
  b."archiveReason"
FROM "subscriptionEntitlementDedupeBackup" b
WHERE NOT EXISTS (
    SELECT 1
    FROM "subscriptionEntitlement" e
    WHERE e."id" = b."id"
  )
  AND (
    (
      b."organizationId" IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM "subscriptionEntitlement" e
        WHERE e."organizationId" = b."organizationId"
      )
    )
    OR (
      b."organizationId" IS NULL
      AND b."userId" IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM "subscriptionEntitlement" e
        WHERE e."organizationId" IS NULL
          AND e."userId" = b."userId"
      )
    )
  );

SELECT
  "id",
  "organizationId",
  "userId",
  "plan",
  "status",
  "remoteRuntimeEnabled",
  "archivedAt",
  "archiveReason"
FROM "_subscription_entitlement_restore_candidates"
ORDER BY "archivedAt", "id";

INSERT INTO "subscriptionEntitlement" (
  "id",
  "organizationId",
  "userId",
  "plan",
  "status",
  "remoteRuntimeEnabled",
  "trialEndsAt",
  "currentPeriodStartsAt",
  "currentPeriodEndsAt",
  "createdAt",
  "updatedAt"
)
SELECT
  "id",
  "organizationId",
  "userId",
  "plan",
  "status",
  "remoteRuntimeEnabled",
  "trialEndsAt",
  "currentPeriodStartsAt",
  "currentPeriodEndsAt",
  "createdAt",
  now()
FROM "_subscription_entitlement_restore_candidates";

SELECT count(*) AS restored_entitlement_rows
FROM "_subscription_entitlement_restore_candidates";

COMMIT;
