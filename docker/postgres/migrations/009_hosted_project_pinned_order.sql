ALTER TABLE "hostedProject" ADD COLUMN IF NOT EXISTS "pinnedOrder" integer;

UPDATE "hostedProject" SET "pinnedOrder" = NULL WHERE pinned = false;

WITH ordered AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY "organizationId", "ownerUserId"
      ORDER BY "createdAt" ASC
    ) - 1 AS ord
  FROM "hostedProject"
  WHERE pinned = true
)
UPDATE "hostedProject" hp
SET "pinnedOrder" = ordered.ord
FROM ordered
WHERE hp.id = ordered.id;
