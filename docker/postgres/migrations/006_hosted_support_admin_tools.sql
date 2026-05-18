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
