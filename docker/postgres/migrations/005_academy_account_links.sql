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
