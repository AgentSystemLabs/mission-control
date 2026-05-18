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
