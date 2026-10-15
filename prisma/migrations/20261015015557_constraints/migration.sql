-- DB-02: the database refuses invalid states

-- CreateIndex
CREATE UNIQUE INDEX "SocialAccount_platformId_externalId_key" ON "SocialAccount"("platformId", "externalId");

-- Status and type columns hold only the codes the application defines (src/lib/workflow/statuses.ts,
-- src/lib/platforms/types.ts). tests/integration/constraints.test.ts compares these lists with the code,
-- so adding a code without a migration fails a test instead of failing in production.
ALTER TABLE "Content" ADD CONSTRAINT "Content_scriptStatus_check" CHECK ("scriptStatus" IN ('NOT_STARTED', 'GENERATING', 'GENERATED', 'NEEDS_REVISION', 'APPROVED'));
ALTER TABLE "Content" ADD CONSTRAINT "Content_imageStatus_check" CHECK ("imageStatus" IN ('NOT_STARTED', 'GENERATING', 'GENERATED', 'NEEDS_REVISION', 'APPROVED'));
ALTER TABLE "Content" ADD CONSTRAINT "Content_videoStatus_check" CHECK ("videoStatus" IN ('NOT_STARTED', 'EDITING', 'GENERATED', 'NEEDS_REVISION', 'FINAL'));
ALTER TABLE "Content" ADD CONSTRAINT "Content_reviewStatus_check" CHECK ("reviewStatus" IN ('NOT_STARTED', 'IN_REVIEW', 'CHANGES_REQUESTED', 'APPROVED'));
ALTER TABLE "Content" ADD CONSTRAINT "Content_publishingStatus_check" CHECK ("publishingStatus" IN ('DRAFT', 'NOT_READY', 'READY', 'SCHEDULED', 'PUBLISHING', 'PUBLISHED', 'FAILED'));
ALTER TABLE "Content" ADD CONSTRAINT "Content_stage_check" CHECK ("stage" IN ('IDEA', 'SCRIPT', 'IMAGES', 'VIDEO', 'REVIEW', 'READY', 'SCHEDULED', 'PUBLISHED', 'FAILED'));
ALTER TABLE "Content" ADD CONSTRAINT "Content_contentType_check" CHECK ("contentType" IN ('LONG_FORM', 'SHORT', 'REEL'));
ALTER TABLE "Content" ADD CONSTRAINT "Content_priority_check" CHECK ("priority" IN ('HIGH', 'MEDIUM', 'LOW'));
ALTER TABLE "PublishingSchedule" ADD CONSTRAINT "PublishingSchedule_status_check" CHECK ("status" IN ('WAITING', 'PROCESSING', 'PUBLISHED', 'FAILED', 'RETRY_SCHEDULED', 'CANCELLED'));
ALTER TABLE "PublishingSchedule" ADD CONSTRAINT "PublishingSchedule_lastErrorCode_check" CHECK ("lastErrorCode" IS NULL OR "lastErrorCode" IN ('AUTH', 'QUOTA', 'RATE', 'VALIDATION', 'NETWORK', 'UNKNOWN', 'UNKNOWN_OUTCOME'));
ALTER TABLE "PublishingSchedule" ADD CONSTRAINT "PublishingSchedule_archivedStatus_check" CHECK ("archivedStatus" IS NULL OR "archivedStatus" IN ('WAITING', 'RETRY_SCHEDULED'));
ALTER TABLE "PublishingJob" ADD CONSTRAINT "PublishingJob_status_check" CHECK ("status" IN ('PROCESSING', 'SUCCEEDED', 'FAILED'));
ALTER TABLE "PublishingJob" ADD CONSTRAINT "PublishingJob_errorCode_check" CHECK ("errorCode" IS NULL OR "errorCode" IN ('AUTH', 'QUOTA', 'RATE', 'VALIDATION', 'NETWORK', 'UNKNOWN', 'UNKNOWN_OUTCOME'));
ALTER TABLE "SocialAccount" ADD CONSTRAINT "SocialAccount_status_check" CHECK ("status" IN ('CONNECTED', 'DISCONNECTED', 'TOKEN_EXPIRED', 'ERROR'));
ALTER TABLE "MediaAsset" ADD CONSTRAINT "MediaAsset_type_check" CHECK ("type" IN ('IMAGE', 'VIDEO', 'THUMBNAIL', 'AUDIO', 'MUSIC', 'OTHER'));
ALTER TABLE "AiPrompt" ADD CONSTRAINT "AiPrompt_category_check" CHECK ("category" IN ('VIDEO_IDEA', 'SCRIPT', 'IMAGE', 'THUMBNAIL', 'TITLE', 'DESCRIPTION', 'HASHTAGS'));
ALTER TABLE "AiPrompt" ADD CONSTRAINT "AiPrompt_provider_check" CHECK ("provider" IN ('CLAUDE', 'GOOGLE_AI_STUDIO', 'GOOGLE_FLOW', 'OTHER'));
ALTER TABLE "ScriptVersion" ADD CONSTRAINT "ScriptVersion_status_check" CHECK ("status" IN ('NOT_STARTED', 'GENERATING', 'GENERATED', 'NEEDS_REVISION', 'APPROVED'));
ALTER TABLE "ScriptVersion" ADD CONSTRAINT "ScriptVersion_source_check" CHECK ("source" IN ('MANUAL', 'PASTE', 'CLAUDE'));
ALTER TABLE "ImagePrompt" ADD CONSTRAINT "ImagePrompt_provider_check" CHECK ("provider" IN ('GOOGLE_AI_STUDIO', 'GOOGLE_FLOW', 'OTHER'));
ALTER TABLE "AnalyticsSnapshot" ADD CONSTRAINT "AnalyticsSnapshot_source_check" CHECK ("source" IN ('MOCK', 'API'));
ALTER TABLE "WorkerHeartbeat" ADD CONSTRAINT "WorkerHeartbeat_mode_check" CHECK ("mode" IN ('INLINE', 'PROCESS', 'CRON'));
ALTER TABLE "User" ADD CONSTRAINT "User_role_check" CHECK ("role" IN ('OWNER'));
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_type_check" CHECK ("type" IN ('ready', 'scheduled_tomorrow', 'published', 'failed', 'token_expired', 'incomplete'));

-- Sizes and counts can't be negative; completion is a percentage.
ALTER TABLE "Content" ADD CONSTRAINT "Content_missingMask_check" CHECK ("missingMask" >= 0);
ALTER TABLE "Content" ADD CONSTRAINT "Content_completion_check" CHECK ("completion" BETWEEN 0 AND 100);
ALTER TABLE "PublishingSchedule" ADD CONSTRAINT "PublishingSchedule_attempts_check" CHECK ("attempts" >= 0);
ALTER TABLE "SocialAccount" ADD CONSTRAINT "SocialAccount_followers_check" CHECK ("followers" >= 0);
ALTER TABLE "MediaAsset" ADD CONSTRAINT "MediaAsset_size_check" CHECK ("size" >= 0);
ALTER TABLE "ScriptVersion" ADD CONSTRAINT "ScriptVersion_wordCount_check" CHECK ("wordCount" >= 0);

-- A file is either uploaded (storageKey) or linked (externalUrl), never both. Neither is allowed:
-- it is a metadata-only record (the demo data has such videos) that has no file to play yet.
ALTER TABLE "MediaAsset" ADD CONSTRAINT "MediaAsset_one_source_check" CHECK ("storageKey" IS NULL OR "externalUrl" IS NULL);

-- At most one default account per platform. Before this, only a transaction kept it true. Any platform
-- that already has several defaults keeps the oldest one.
UPDATE "SocialAccount" a SET "isDefault" = false
WHERE a."isDefault" AND EXISTS (
  SELECT 1 FROM "SocialAccount" b
  WHERE b."platformId" = a."platformId" AND b."isDefault" AND (b."createdAt", b."id") < (a."createdAt", a."id")
);
CREATE UNIQUE INDEX "SocialAccount_one_default_per_platform" ON "SocialAccount"("platformId") WHERE "isDefault";
