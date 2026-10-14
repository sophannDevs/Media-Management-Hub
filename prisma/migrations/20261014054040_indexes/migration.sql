-- DB-01: indexes for file lookups, the retry scan, account views and the calendar.

-- CreateIndex
CREATE UNIQUE INDEX "MediaAsset_storageKey_key" ON "MediaAsset"("storageKey");

-- CreateIndex
CREATE INDEX "PublishingSchedule_status_nextAttemptAt_idx" ON "PublishingSchedule"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "PublishingSchedule_accountId_idx" ON "PublishingSchedule"("accountId");

-- CreateIndex
CREATE INDEX "PublishingSchedule_platformId_scheduledAt_idx" ON "PublishingSchedule"("platformId", "scheduledAt");

