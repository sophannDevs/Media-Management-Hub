-- DropForeignKey
ALTER TABLE "ActivityLog" DROP CONSTRAINT "ActivityLog_userId_fkey";

-- AlterTable
ALTER TABLE "ActivityLog" DROP COLUMN "userId",
ADD COLUMN     "actorId" TEXT,
ADD COLUMN     "entityId" TEXT,
ADD COLUMN     "entityType" TEXT NOT NULL DEFAULT 'CONTENT',
ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'USER';

-- CreateIndex
CREATE INDEX "ActivityLog_entityType_entityId_createdAt_idx" ON "ActivityLog"("entityType", "entityId", "createdAt");

-- CreateIndex
CREATE INDEX "ActivityLog_actorId_createdAt_idx" ON "ActivityLog"("actorId", "createdAt");

-- AddForeignKey
ALTER TABLE "ActivityLog" ADD CONSTRAINT "ActivityLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Existing rows (DB-05): the worker's publish results, and what each row was about
UPDATE "ActivityLog" SET "source" = 'WORKER' WHERE "type" IN ('publish.succeeded', 'publish.failed');
UPDATE "ActivityLog" SET "entityType" = 'SCHEDULE', "entityId" = "meta"->>'scheduleId' WHERE "type" LIKE 'schedule.%' OR "type" LIKE 'publish.%';
UPDATE "ActivityLog" SET "entityType" = 'MEDIA', "entityId" = "meta"->>'assetId' WHERE "type" IN ('media.uploaded', 'media.deleted', 'video.uploaded');
UPDATE "ActivityLog" SET "entityId" = "contentId" WHERE "entityType" = 'CONTENT' AND "entityId" IS NULL;
