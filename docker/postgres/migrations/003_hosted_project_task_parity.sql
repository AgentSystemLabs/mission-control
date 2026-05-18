CREATE TABLE IF NOT EXISTS "user" (
  "id" text PRIMARY KEY,
  "name" text NOT NULL,
  "email" text NOT NULL UNIQUE,
  "emailVerified" boolean NOT NULL DEFAULT false,
  "image" text,
  "createdAt" timestamp NOT NULL,
  "updatedAt" timestamp NOT NULL
);

CREATE TABLE IF NOT EXISTS "organization" (
  "id" text PRIMARY KEY,
  "name" text NOT NULL,
  "slug" text UNIQUE,
  "logo" text,
  "createdAt" timestamp NOT NULL,
  "metadata" text
);

CREATE TABLE IF NOT EXISTS "subscriptionEntitlement" (
  "id" text PRIMARY KEY,
  "organizationId" text REFERENCES "organization"("id") ON DELETE CASCADE,
  "userId" text REFERENCES "user"("id") ON DELETE CASCADE,
  "plan" text NOT NULL CHECK ("plan" IN ('none', 'trial', 'paid')),
  "status" text NOT NULL CHECK ("status" IN ('inactive', 'trialing', 'active', 'past_due', 'canceled')),
  "remoteRuntimeEnabled" boolean NOT NULL DEFAULT false,
  "trialEndsAt" timestamp,
  "currentPeriodStartsAt" timestamp,
  "currentPeriodEndsAt" timestamp,
  "createdAt" timestamp NOT NULL DEFAULT now(),
  "updatedAt" timestamp NOT NULL DEFAULT now(),
  CHECK ("organizationId" IS NOT NULL OR "userId" IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS "hostedProject" (
  "id" text PRIMARY KEY,
  "organizationId" text REFERENCES "organization"("id") ON DELETE CASCADE,
  "ownerUserId" text REFERENCES "user"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "runtime" text NOT NULL DEFAULT 'local' CHECK ("runtime" IN ('local', 'daytona')),
  "remoteProvider" text,
  "remoteSandboxId" text,
  "remotePath" text,
  "githubUrl" text,
  "branch" text NOT NULL DEFAULT 'main',
  "createdAt" timestamp NOT NULL DEFAULT now(),
  "updatedAt" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "hostedProject_organizationId_idx"
  ON "hostedProject"("organizationId");
CREATE INDEX IF NOT EXISTS "hostedProject_ownerUserId_idx"
  ON "hostedProject"("ownerUserId");

CREATE TABLE IF NOT EXISTS "hostedTask" (
  "id" text PRIMARY KEY,
  "projectId" text NOT NULL REFERENCES "hostedProject"("id") ON DELETE CASCADE,
  "title" text NOT NULL,
  "agent" text NOT NULL,
  "status" text NOT NULL,
  "createdAt" timestamp NOT NULL DEFAULT now(),
  "updatedAt" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "hostedTask_projectId_idx"
  ON "hostedTask"("projectId");

CREATE TABLE IF NOT EXISTS "subscriptionEntitlementDedupeBackup" (
  LIKE "subscriptionEntitlement" INCLUDING ALL,
  "archivedAt" timestamp NOT NULL DEFAULT now(),
  "archiveReason" text NOT NULL
);

WITH ranked AS (
  SELECT
    "id",
    row_number() OVER (
      PARTITION BY "organizationId"
      ORDER BY
        CASE
          WHEN "remoteRuntimeEnabled"
            AND "plan" = 'paid'
            AND "status" = 'active'
            AND ("currentPeriodEndsAt" IS NULL OR "currentPeriodEndsAt" > now())
            THEN 3
          WHEN "remoteRuntimeEnabled"
            AND "plan" = 'trial'
            AND "status" = 'trialing'
            AND ("trialEndsAt" IS NULL OR "trialEndsAt" > now())
            THEN 2
          ELSE 1
        END DESC,
        "remoteRuntimeEnabled" DESC,
        CASE "plan" WHEN 'paid' THEN 3 WHEN 'trial' THEN 2 ELSE 1 END DESC,
        CASE "status" WHEN 'active' THEN 3 WHEN 'trialing' THEN 2 ELSE 1 END DESC,
        "updatedAt" DESC,
        "createdAt" DESC
    ) AS rn
  FROM "subscriptionEntitlement"
  WHERE "organizationId" IS NOT NULL
)
INSERT INTO "subscriptionEntitlementDedupeBackup"
SELECT e.*, now(), 'dedupe-before-organization-unique-index'
FROM "subscriptionEntitlement" e
WHERE e."id" IN (SELECT "id" FROM ranked WHERE rn > 1)
ON CONFLICT ("id") DO NOTHING;

WITH ranked AS (
  SELECT
    "id",
    row_number() OVER (
      PARTITION BY "organizationId"
      ORDER BY
        CASE
          WHEN "remoteRuntimeEnabled"
            AND "plan" = 'paid'
            AND "status" = 'active'
            AND ("currentPeriodEndsAt" IS NULL OR "currentPeriodEndsAt" > now())
            THEN 3
          WHEN "remoteRuntimeEnabled"
            AND "plan" = 'trial'
            AND "status" = 'trialing'
            AND ("trialEndsAt" IS NULL OR "trialEndsAt" > now())
            THEN 2
          ELSE 1
        END DESC,
        "remoteRuntimeEnabled" DESC,
        CASE "plan" WHEN 'paid' THEN 3 WHEN 'trial' THEN 2 ELSE 1 END DESC,
        CASE "status" WHEN 'active' THEN 3 WHEN 'trialing' THEN 2 ELSE 1 END DESC,
        "updatedAt" DESC,
        "createdAt" DESC
    ) AS rn
  FROM "subscriptionEntitlement"
  WHERE "organizationId" IS NOT NULL
)
DELETE FROM "subscriptionEntitlement"
WHERE "id" IN (SELECT "id" FROM ranked WHERE rn > 1);

WITH ranked AS (
  SELECT
    "id",
    row_number() OVER (
      PARTITION BY "userId"
      ORDER BY
        CASE
          WHEN "remoteRuntimeEnabled"
            AND "plan" = 'paid'
            AND "status" = 'active'
            AND ("currentPeriodEndsAt" IS NULL OR "currentPeriodEndsAt" > now())
            THEN 3
          WHEN "remoteRuntimeEnabled"
            AND "plan" = 'trial'
            AND "status" = 'trialing'
            AND ("trialEndsAt" IS NULL OR "trialEndsAt" > now())
            THEN 2
          ELSE 1
        END DESC,
        "remoteRuntimeEnabled" DESC,
        CASE "plan" WHEN 'paid' THEN 3 WHEN 'trial' THEN 2 ELSE 1 END DESC,
        CASE "status" WHEN 'active' THEN 3 WHEN 'trialing' THEN 2 ELSE 1 END DESC,
        "updatedAt" DESC,
        "createdAt" DESC
    ) AS rn
  FROM "subscriptionEntitlement"
  WHERE "organizationId" IS NULL AND "userId" IS NOT NULL
)
INSERT INTO "subscriptionEntitlementDedupeBackup"
SELECT e.*, now(), 'dedupe-before-user-unique-index'
FROM "subscriptionEntitlement" e
WHERE e."id" IN (SELECT "id" FROM ranked WHERE rn > 1)
ON CONFLICT ("id") DO NOTHING;

WITH ranked AS (
  SELECT
    "id",
    row_number() OVER (
      PARTITION BY "userId"
      ORDER BY
        CASE
          WHEN "remoteRuntimeEnabled"
            AND "plan" = 'paid'
            AND "status" = 'active'
            AND ("currentPeriodEndsAt" IS NULL OR "currentPeriodEndsAt" > now())
            THEN 3
          WHEN "remoteRuntimeEnabled"
            AND "plan" = 'trial'
            AND "status" = 'trialing'
            AND ("trialEndsAt" IS NULL OR "trialEndsAt" > now())
            THEN 2
          ELSE 1
        END DESC,
        "remoteRuntimeEnabled" DESC,
        CASE "plan" WHEN 'paid' THEN 3 WHEN 'trial' THEN 2 ELSE 1 END DESC,
        CASE "status" WHEN 'active' THEN 3 WHEN 'trialing' THEN 2 ELSE 1 END DESC,
        "updatedAt" DESC,
        "createdAt" DESC
    ) AS rn
  FROM "subscriptionEntitlement"
  WHERE "organizationId" IS NULL AND "userId" IS NOT NULL
)
DELETE FROM "subscriptionEntitlement"
WHERE "id" IN (SELECT "id" FROM ranked WHERE rn > 1);

CREATE UNIQUE INDEX IF NOT EXISTS "subscriptionEntitlement_organizationId_unique"
  ON "subscriptionEntitlement"("organizationId")
  WHERE "organizationId" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "subscriptionEntitlement_userId_unique"
  ON "subscriptionEntitlement"("userId")
  WHERE "organizationId" IS NULL AND "userId" IS NOT NULL;

CREATE TABLE IF NOT EXISTS "hostedGroup" (
  "id" text PRIMARY KEY,
  "organizationId" text REFERENCES "organization"("id") ON DELETE CASCADE,
  "ownerUserId" text REFERENCES "user"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "color" text NOT NULL,
  "createdAt" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "hostedGroup_scope_check"
    CHECK (("organizationId" IS NOT NULL) <> ("ownerUserId" IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS "hostedGroup_organizationId_idx"
  ON "hostedGroup"("organizationId");
CREATE INDEX IF NOT EXISTS "hostedGroup_ownerUserId_idx"
  ON "hostedGroup"("ownerUserId");

INSERT INTO "user" ("id", "name", "email", "emailVerified", "image", "createdAt", "updatedAt")
VALUES (
  'migration-unscoped-owner',
  'Migration Unscoped Owner',
  'migration-unscoped-owner@example.invalid',
  false,
  NULL,
  now(),
  now()
)
ON CONFLICT ("id") DO NOTHING;

UPDATE "hostedProject"
SET "ownerUserId" = 'migration-unscoped-owner'
WHERE "organizationId" IS NULL AND "ownerUserId" IS NULL;

UPDATE "hostedProject"
SET "ownerUserId" = NULL
WHERE "organizationId" IS NOT NULL AND "ownerUserId" IS NOT NULL;

ALTER TABLE "hostedProject" ADD COLUMN IF NOT EXISTS "groupId" text;
UPDATE "hostedProject" p
SET "groupId" = NULL
WHERE p."groupId" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM "hostedGroup" g
    WHERE g."id" = p."groupId"
      AND (
        (p."organizationId" IS NOT NULL AND g."organizationId" = p."organizationId")
        OR (
          p."organizationId" IS NULL
          AND g."organizationId" IS NULL
          AND g."ownerUserId" = p."ownerUserId"
        )
      )
  );
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'hostedProject_groupId_fkey'
  ) THEN
    ALTER TABLE "hostedProject"
      ADD CONSTRAINT "hostedProject_groupId_fkey"
      FOREIGN KEY ("groupId") REFERENCES "hostedGroup"("id") ON DELETE SET NULL;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION enforce_hosted_project_group_scope()
RETURNS trigger AS $$
BEGIN
  IF NEW."groupId" IS NULL THEN
    RETURN NEW;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM "hostedGroup"
    WHERE "id" = NEW."groupId"
      AND (
        (NEW."organizationId" IS NOT NULL AND "organizationId" = NEW."organizationId")
        OR (
          NEW."organizationId" IS NULL
          AND "organizationId" IS NULL
          AND "ownerUserId" = NEW."ownerUserId"
        )
      )
  ) THEN
    RAISE EXCEPTION 'hostedProject.groupId must reference a group in the same scope';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "hostedProject_group_scope" ON "hostedProject";
CREATE TRIGGER "hostedProject_group_scope"
  BEFORE INSERT OR UPDATE OF "groupId", "organizationId", "ownerUserId"
  ON "hostedProject"
  FOR EACH ROW
  EXECUTE FUNCTION enforce_hosted_project_group_scope();

ALTER TABLE "hostedProject" ADD COLUMN IF NOT EXISTS "icon" text NOT NULL DEFAULT 'PR';
ALTER TABLE "hostedProject" ADD COLUMN IF NOT EXISTS "iconColor" text NOT NULL DEFAULT '#ff5a1f';
ALTER TABLE "hostedProject" ADD COLUMN IF NOT EXISTS "imagePath" text;
ALTER TABLE "hostedProject" ADD COLUMN IF NOT EXISTS "pinned" boolean NOT NULL DEFAULT false;
ALTER TABLE "hostedProject" ADD COLUMN IF NOT EXISTS "launchCommands" jsonb;
ALTER TABLE "hostedProject" ADD COLUMN IF NOT EXISTS "launchUrl" text;
ALTER TABLE "hostedProject" ADD COLUMN IF NOT EXISTS "rememberAgentSettings" boolean NOT NULL DEFAULT false;
ALTER TABLE "hostedProject" ADD COLUMN IF NOT EXISTS "savedAgent" text;
ALTER TABLE "hostedProject" ADD COLUMN IF NOT EXISTS "savedSkipPermissions" boolean NOT NULL DEFAULT false;
ALTER TABLE "hostedProject" ADD COLUMN IF NOT EXISTS "savedBareSession" boolean NOT NULL DEFAULT false;
ALTER TABLE "hostedProject" DROP CONSTRAINT IF EXISTS "hostedProject_scope_check";
ALTER TABLE "hostedProject"
  ADD CONSTRAINT "hostedProject_scope_check"
  CHECK (("organizationId" IS NOT NULL) <> ("ownerUserId" IS NOT NULL)) NOT VALID;

ALTER TABLE "hostedTask" ADD COLUMN IF NOT EXISTS "icon" text;
ALTER TABLE "hostedTask" ADD COLUMN IF NOT EXISTS "branch" text NOT NULL DEFAULT 'main';
ALTER TABLE "hostedTask" ADD COLUMN IF NOT EXISTS "preview" text NOT NULL DEFAULT '';
ALTER TABLE "hostedTask" ADD COLUMN IF NOT EXISTS "lines" integer NOT NULL DEFAULT 0;
ALTER TABLE "hostedTask" ADD COLUMN IF NOT EXISTS "archived" boolean NOT NULL DEFAULT false;
ALTER TABLE "hostedTask" ADD COLUMN IF NOT EXISTS "claudeSessionId" text;
ALTER TABLE "hostedTask" ADD COLUMN IF NOT EXISTS "claudeSkipPermissions" boolean NOT NULL DEFAULT false;
ALTER TABLE "hostedTask" ADD COLUMN IF NOT EXISTS "claudeBareSession" boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS "hostedUserTerminal" (
  "id" text PRIMARY KEY,
  "projectId" text NOT NULL REFERENCES "hostedProject"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "cwd" text,
  "startCommand" text,
  "position" integer NOT NULL DEFAULT 0,
  "createdAt" timestamp NOT NULL DEFAULT now(),
  "updatedAt" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "hostedUserTerminal_projectId_idx"
  ON "hostedUserTerminal"("projectId");

CREATE TABLE IF NOT EXISTS "hookToken" (
  "id" text PRIMARY KEY,
  "taskId" text NOT NULL REFERENCES "hostedTask"("id") ON DELETE CASCADE,
  "tokenHash" text NOT NULL UNIQUE,
  "eventScope" text NOT NULL DEFAULT 'agent-hooks',
  "expiresAt" timestamp NOT NULL,
  "revokedAt" timestamp,
  "createdAt" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "hookToken_taskId_idx"
  ON "hookToken"("taskId");
CREATE INDEX IF NOT EXISTS "hookToken_expiresAt_idx"
  ON "hookToken"("expiresAt");

CREATE TABLE IF NOT EXISTS "hostedCleanupOutbox" (
  "id" text PRIMARY KEY,
  "kind" text NOT NULL CHECK ("kind" IN ('daytona-project-sandboxes')),
  "scope" jsonb NOT NULL,
  "payload" jsonb NOT NULL,
  "status" text NOT NULL DEFAULT 'pending' CHECK ("status" IN ('pending', 'processing', 'done', 'failed')),
  "attempts" integer NOT NULL DEFAULT 0,
  "lastError" text,
  "createdAt" timestamp NOT NULL DEFAULT now(),
  "updatedAt" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "hostedCleanupOutbox_status_idx"
  ON "hostedCleanupOutbox"("status");
