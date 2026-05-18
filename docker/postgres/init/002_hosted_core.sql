CREATE TABLE IF NOT EXISTS "organization" (
  "id" text PRIMARY KEY,
  "name" text NOT NULL,
  "slug" text NOT NULL UNIQUE,
  "createdAt" timestamp NOT NULL DEFAULT now(),
  "updatedAt" timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "organizationMembership" (
  "id" text PRIMARY KEY,
  "organizationId" text NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "userId" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "role" text NOT NULL CHECK ("role" IN ('owner', 'admin', 'member')),
  "createdAt" timestamp NOT NULL DEFAULT now(),
  "updatedAt" timestamp NOT NULL DEFAULT now(),
  UNIQUE ("organizationId", "userId")
);
CREATE INDEX IF NOT EXISTS "organizationMembership_userId_idx"
  ON "organizationMembership"("userId");

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
CREATE INDEX IF NOT EXISTS "subscriptionEntitlement_organizationId_idx"
  ON "subscriptionEntitlement"("organizationId");
CREATE INDEX IF NOT EXISTS "subscriptionEntitlement_userId_idx"
  ON "subscriptionEntitlement"("userId");
CREATE UNIQUE INDEX IF NOT EXISTS "subscriptionEntitlement_organizationId_unique"
  ON "subscriptionEntitlement"("organizationId")
  WHERE "organizationId" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "subscriptionEntitlement_userId_unique"
  ON "subscriptionEntitlement"("userId")
  WHERE "organizationId" IS NULL AND "userId" IS NOT NULL;

CREATE TABLE IF NOT EXISTS "academyAccountLink" (
  "id" text PRIMARY KEY,
  "userId" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "academyUserId" text NOT NULL UNIQUE,
  "email" text NOT NULL,
  "emailVerified" boolean NOT NULL DEFAULT false,
  "sourceTier" text,
  "billingStatus" text NOT NULL,
  "missionControlHosted" boolean NOT NULL DEFAULT false,
  "remoteRuntimeEnabled" boolean NOT NULL DEFAULT false,
  "lastSyncedAt" timestamp NOT NULL DEFAULT now(),
  "lastAcademyEntitlementVersion" text,
  "createdAt" timestamp NOT NULL DEFAULT now(),
  "updatedAt" timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "academyAccountLink_userId_unique"
  ON "academyAccountLink"("userId");
CREATE INDEX IF NOT EXISTS "academyAccountLink_lastSyncedAt_idx"
  ON "academyAccountLink"("lastSyncedAt");

CREATE TABLE IF NOT EXISTS "hostedSession" (
  "id" text PRIMARY KEY,
  "userId" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "academyUserId" text NOT NULL,
  "tokenHash" text NOT NULL UNIQUE,
  "expiresAt" timestamp NOT NULL,
  "revokedAt" timestamp,
  "createdAt" timestamp NOT NULL DEFAULT now(),
  "updatedAt" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "hostedSession_userId_idx"
  ON "hostedSession"("userId");
CREATE INDEX IF NOT EXISTS "hostedSession_academyUserId_idx"
  ON "hostedSession"("academyUserId");
CREATE INDEX IF NOT EXISTS "hostedSession_expiresAt_idx"
  ON "hostedSession"("expiresAt");

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

CREATE TABLE IF NOT EXISTS "hostedProject" (
  "id" text PRIMARY KEY,
  "organizationId" text REFERENCES "organization"("id") ON DELETE CASCADE,
  "ownerUserId" text REFERENCES "user"("id") ON DELETE CASCADE,
  "groupId" text REFERENCES "hostedGroup"("id") ON DELETE SET NULL,
  "name" text NOT NULL,
  "runtime" text NOT NULL DEFAULT 'local' CHECK ("runtime" IN ('local', 'daytona')),
  "remoteProvider" text,
  "remoteSandboxId" text,
  "remotePath" text,
  "githubUrl" text,
  "branch" text NOT NULL DEFAULT 'main',
  "icon" text NOT NULL DEFAULT 'PR',
  "iconColor" text NOT NULL DEFAULT '#ff5a1f',
  "imagePath" text,
  "pinned" boolean NOT NULL DEFAULT false,
  "launchCommands" jsonb,
  "launchUrl" text,
  "rememberAgentSettings" boolean NOT NULL DEFAULT false,
  "savedAgent" text,
  "savedSkipPermissions" boolean NOT NULL DEFAULT false,
  "savedBareSession" boolean NOT NULL DEFAULT false,
  "createdAt" timestamp NOT NULL DEFAULT now(),
  "updatedAt" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "hostedProject_scope_check"
    CHECK (("organizationId" IS NOT NULL) <> ("ownerUserId" IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS "hostedProject_organizationId_idx"
  ON "hostedProject"("organizationId");
CREATE INDEX IF NOT EXISTS "hostedProject_ownerUserId_idx"
  ON "hostedProject"("ownerUserId");
CREATE INDEX IF NOT EXISTS "hostedProject_runtime_idx"
  ON "hostedProject"("runtime");

ALTER TABLE "hostedProject" ADD COLUMN IF NOT EXISTS "icon" text NOT NULL DEFAULT 'PR';
ALTER TABLE "hostedProject" ADD COLUMN IF NOT EXISTS "groupId" text;
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
  CHECK (("organizationId" IS NOT NULL) <> ("ownerUserId" IS NOT NULL));
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

CREATE TABLE IF NOT EXISTS "hostedTask" (
  "id" text PRIMARY KEY,
  "projectId" text NOT NULL REFERENCES "hostedProject"("id") ON DELETE CASCADE,
  "title" text NOT NULL,
  "agent" text NOT NULL,
  "status" text NOT NULL,
  "branch" text NOT NULL DEFAULT 'main',
  "preview" text NOT NULL DEFAULT '',
  "lines" integer NOT NULL DEFAULT 0,
  "archived" boolean NOT NULL DEFAULT false,
  "icon" text,
  "claudeSessionId" text,
  "claudeSkipPermissions" boolean NOT NULL DEFAULT false,
  "claudeBareSession" boolean NOT NULL DEFAULT false,
  "createdAt" timestamp NOT NULL DEFAULT now(),
  "updatedAt" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "hostedTask_projectId_idx"
  ON "hostedTask"("projectId");
CREATE INDEX IF NOT EXISTS "hostedTask_status_idx"
  ON "hostedTask"("status");

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

CREATE TABLE IF NOT EXISTS "hostedTerminalSession" (
  "id" text PRIMARY KEY,
  "taskId" text REFERENCES "hostedTask"("id") ON DELETE CASCADE,
  "projectId" text NOT NULL REFERENCES "hostedProject"("id") ON DELETE CASCADE,
  "sandboxInstanceId" text,
  "ptyId" text,
  "kind" text NOT NULL CHECK ("kind" IN ('agent', 'user')),
  "status" text NOT NULL CHECK ("status" IN ('starting', 'running', 'exited', 'failed')),
  "startedAt" timestamp NOT NULL DEFAULT now(),
  "endedAt" timestamp,
  "createdAt" timestamp NOT NULL DEFAULT now(),
  "updatedAt" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "hostedTerminalSession_projectId_idx"
  ON "hostedTerminalSession"("projectId");
CREATE INDEX IF NOT EXISTS "hostedTerminalSession_taskId_idx"
  ON "hostedTerminalSession"("taskId");

CREATE TABLE IF NOT EXISTS "sandboxInstance" (
  "id" text PRIMARY KEY,
  "organizationId" text REFERENCES "organization"("id") ON DELETE CASCADE,
  "userId" text REFERENCES "user"("id") ON DELETE CASCADE,
  "provider" text NOT NULL CHECK ("provider" IN ('daytona')),
  "externalId" text NOT NULL,
  "name" text NOT NULL,
  "state" text NOT NULL,
  "target" text,
  "autoStopInterval" integer,
  "lastActivityAt" timestamp,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "createdAt" timestamp NOT NULL DEFAULT now(),
  "updatedAt" timestamp NOT NULL DEFAULT now(),
  CHECK ("organizationId" IS NOT NULL OR "userId" IS NOT NULL),
  UNIQUE ("provider", "externalId")
);
CREATE INDEX IF NOT EXISTS "sandboxInstance_organizationId_idx"
  ON "sandboxInstance"("organizationId");
CREATE INDEX IF NOT EXISTS "sandboxInstance_userId_idx"
  ON "sandboxInstance"("userId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'hostedTerminalSession_sandboxInstanceId_fkey'
  ) THEN
    ALTER TABLE "hostedTerminalSession"
      ADD CONSTRAINT "hostedTerminalSession_sandboxInstanceId_fkey"
      FOREIGN KEY ("sandboxInstanceId") REFERENCES "sandboxInstance"("id") ON DELETE SET NULL;
  END IF;
END $$;

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

CREATE TABLE IF NOT EXISTS "hostedAdminAuditLog" (
  "id" text PRIMARY KEY,
  "actor" text NOT NULL,
  "action" text NOT NULL,
  "targetType" text NOT NULL,
  "targetId" text,
  "reason" text,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "createdAt" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "hostedAdminAuditLog_createdAt_idx"
  ON "hostedAdminAuditLog"("createdAt");
CREATE INDEX IF NOT EXISTS "hostedAdminAuditLog_target_idx"
  ON "hostedAdminAuditLog"("targetType", "targetId");
