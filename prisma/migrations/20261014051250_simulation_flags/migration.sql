-- PUB-05: label simulated publishing and simulated metrics.

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_AnalyticsSnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "source" TEXT NOT NULL DEFAULT 'MOCK',
    "contentId" TEXT NOT NULL,
    "platformId" TEXT NOT NULL,
    "scheduleId" TEXT,
    "date" DATETIME NOT NULL,
    "views" INTEGER NOT NULL DEFAULT 0,
    "likes" INTEGER NOT NULL DEFAULT 0,
    "comments" INTEGER NOT NULL DEFAULT 0,
    "shares" INTEGER NOT NULL DEFAULT 0,
    "watchMinutes" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "AnalyticsSnapshot_contentId_fkey" FOREIGN KEY ("contentId") REFERENCES "Content" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AnalyticsSnapshot_platformId_fkey" FOREIGN KEY ("platformId") REFERENCES "Platform" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AnalyticsSnapshot_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "PublishingSchedule" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_AnalyticsSnapshot" ("comments", "contentId", "date", "id", "likes", "platformId", "scheduleId", "shares", "views", "watchMinutes") SELECT "comments", "contentId", "date", "id", "likes", "platformId", "scheduleId", "shares", "views", "watchMinutes" FROM "AnalyticsSnapshot";
DROP TABLE "AnalyticsSnapshot";
ALTER TABLE "new_AnalyticsSnapshot" RENAME TO "AnalyticsSnapshot";
CREATE INDEX "AnalyticsSnapshot_date_idx" ON "AnalyticsSnapshot"("date");
CREATE UNIQUE INDEX "AnalyticsSnapshot_contentId_platformId_date_key" ON "AnalyticsSnapshot"("contentId", "platformId", "date");
CREATE TABLE "new_PublishingSchedule" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "contentId" TEXT NOT NULL,
    "platformId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "scheduledAt" DATETIME NOT NULL,
    "timezone" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "caption" TEXT NOT NULL DEFAULT '',
    "hashtags" TEXT NOT NULL DEFAULT '',
    "thumbnailAssetId" TEXT,
    "visibility" TEXT NOT NULL DEFAULT 'PUBLIC',
    "options" TEXT NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'WAITING',
    "activeKey" TEXT,
    "idempotencyKey" TEXT,
    "lockedBy" TEXT,
    "lockedUntil" DATETIME,
    "uploadState" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" DATETIME,
    "lastError" TEXT,
    "lastErrorCode" TEXT,
    "externalId" TEXT,
    "externalUrl" TEXT,
    "publishedAt" DATETIME,
    "simulated" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PublishingSchedule_contentId_fkey" FOREIGN KEY ("contentId") REFERENCES "Content" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PublishingSchedule_platformId_fkey" FOREIGN KEY ("platformId") REFERENCES "Platform" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PublishingSchedule_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "SocialAccount" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PublishingSchedule_thumbnailAssetId_fkey" FOREIGN KEY ("thumbnailAssetId") REFERENCES "MediaAsset" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_PublishingSchedule" ("accountId", "activeKey", "attempts", "caption", "contentId", "createdAt", "externalId", "externalUrl", "hashtags", "id", "idempotencyKey", "lastError", "lastErrorCode", "lockedBy", "lockedUntil", "nextAttemptAt", "options", "platformId", "publishedAt", "scheduledAt", "status", "thumbnailAssetId", "timezone", "title", "updatedAt", "uploadState", "visibility") SELECT "accountId", "activeKey", "attempts", "caption", "contentId", "createdAt", "externalId", "externalUrl", "hashtags", "id", "idempotencyKey", "lastError", "lastErrorCode", "lockedBy", "lockedUntil", "nextAttemptAt", "options", "platformId", "publishedAt", "scheduledAt", "status", "thumbnailAssetId", "timezone", "title", "updatedAt", "uploadState", "visibility" FROM "PublishingSchedule";
DROP TABLE "PublishingSchedule";
ALTER TABLE "new_PublishingSchedule" RENAME TO "PublishingSchedule";
CREATE UNIQUE INDEX "PublishingSchedule_activeKey_key" ON "PublishingSchedule"("activeKey");
CREATE UNIQUE INDEX "PublishingSchedule_idempotencyKey_key" ON "PublishingSchedule"("idempotencyKey");
CREATE INDEX "PublishingSchedule_status_scheduledAt_idx" ON "PublishingSchedule"("status", "scheduledAt");
CREATE INDEX "PublishingSchedule_status_lockedUntil_idx" ON "PublishingSchedule"("status", "lockedUntil");
CREATE INDEX "PublishingSchedule_contentId_idx" ON "PublishingSchedule"("contentId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;


-- Backfill: every post published so far came from the simulated providers
-- (no real platform integration has existed), and every metric was generated.
UPDATE "PublishingSchedule" SET "simulated" = true WHERE "status" = 'PUBLISHED' OR "externalId" IS NOT NULL;
