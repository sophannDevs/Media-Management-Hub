-- WF-01: per-post override of soft requirements, with a reason. Existing schedules are untouched.

-- AlterTable
ALTER TABLE "PublishingSchedule" ADD COLUMN "overrideAt" DATETIME;
ALTER TABLE "PublishingSchedule" ADD COLUMN "overrideBy" TEXT;
ALTER TABLE "PublishingSchedule" ADD COLUMN "overrideReason" TEXT;
ALTER TABLE "PublishingSchedule" ADD COLUMN "overrideRules" TEXT;

