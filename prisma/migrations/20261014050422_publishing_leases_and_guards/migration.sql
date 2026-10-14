-- PUB-01 to PUB-04: worker leases, error codes, one active schedule per
-- content and account, and idempotent schedule creation.

-- AlterTable
ALTER TABLE "PublishingJob" ADD COLUMN "errorCode" TEXT;

-- AlterTable
ALTER TABLE "PublishingSchedule" ADD COLUMN "activeKey" TEXT;
ALTER TABLE "PublishingSchedule" ADD COLUMN "idempotencyKey" TEXT;
ALTER TABLE "PublishingSchedule" ADD COLUMN "lastErrorCode" TEXT;
ALTER TABLE "PublishingSchedule" ADD COLUMN "lockedBy" TEXT;
ALTER TABLE "PublishingSchedule" ADD COLUMN "lockedUntil" DATETIME;
ALTER TABLE "PublishingSchedule" ADD COLUMN "uploadState" TEXT;

-- Backfill: mark each active post. If a content item already has several
-- active posts for one account (possible before this change), only the oldest
-- gets the key, so the unique index below can always be created. The others
-- still publish as before; they just can't be re-activated alongside it.
UPDATE "PublishingSchedule" SET "activeKey" = "contentId" || ':' || "accountId"
WHERE "status" IN ('WAITING', 'PROCESSING', 'RETRY_SCHEDULED')
  AND "id" = (
    SELECT p2."id" FROM "PublishingSchedule" p2
    WHERE p2."contentId" = "PublishingSchedule"."contentId"
      AND p2."accountId" = "PublishingSchedule"."accountId"
      AND p2."status" IN ('WAITING', 'PROCESSING', 'RETRY_SCHEDULED')
    ORDER BY p2."createdAt", p2."id"
    LIMIT 1
  );

-- CreateIndex
CREATE UNIQUE INDEX "PublishingSchedule_activeKey_key" ON "PublishingSchedule"("activeKey");

-- CreateIndex
CREATE UNIQUE INDEX "PublishingSchedule_idempotencyKey_key" ON "PublishingSchedule"("idempotencyKey");

-- CreateIndex
CREATE INDEX "PublishingSchedule_status_lockedUntil_idx" ON "PublishingSchedule"("status", "lockedUntil");
