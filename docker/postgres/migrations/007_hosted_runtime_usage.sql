CREATE TABLE IF NOT EXISTS "hostedRuntimeUsage" (
  "id" text PRIMARY KEY,
  "organizationId" text,
  "userId" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "projectId" text NOT NULL REFERENCES "hostedProject"("id") ON DELETE CASCADE,
  "taskId" text REFERENCES "hostedTask"("id") ON DELETE SET NULL,
  "ptyId" text NOT NULL UNIQUE,
  "provider" text NOT NULL DEFAULT 'daytona',
  "sandboxId" text,
  "startedAt" timestamp NOT NULL DEFAULT now(),
  "endedAt" timestamp,
  "durationSeconds" integer,
  "createdAt" timestamp NOT NULL DEFAULT now(),
  "updatedAt" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "hostedRuntimeUsage_user_started_idx"
  ON "hostedRuntimeUsage"("userId", "startedAt" DESC);
CREATE INDEX IF NOT EXISTS "hostedRuntimeUsage_org_started_idx"
  ON "hostedRuntimeUsage"("organizationId", "startedAt" DESC);
CREATE INDEX IF NOT EXISTS "hostedRuntimeUsage_project_started_idx"
  ON "hostedRuntimeUsage"("projectId", "startedAt" DESC);
