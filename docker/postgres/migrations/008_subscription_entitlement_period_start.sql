ALTER TABLE "subscriptionEntitlement"
  ADD COLUMN IF NOT EXISTS "currentPeriodStartsAt" timestamp;

ALTER TABLE "subscriptionEntitlementDedupeBackup"
  ADD COLUMN IF NOT EXISTS "currentPeriodStartsAt" timestamp;
