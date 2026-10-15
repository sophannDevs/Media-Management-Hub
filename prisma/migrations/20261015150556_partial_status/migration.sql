-- A content item live on some platforms and failed on others is PARTIAL (WF-02)
ALTER TABLE "Content" DROP CONSTRAINT "Content_publishingStatus_check";
ALTER TABLE "Content" ADD CONSTRAINT "Content_publishingStatus_check" CHECK ("publishingStatus" IN ('DRAFT', 'NOT_READY', 'READY', 'SCHEDULED', 'PUBLISHING', 'PUBLISHED', 'PARTIAL', 'FAILED'));
ALTER TABLE "Content" DROP CONSTRAINT "Content_stage_check";
ALTER TABLE "Content" ADD CONSTRAINT "Content_stage_check" CHECK ("stage" IN ('IDEA', 'SCRIPT', 'IMAGES', 'VIDEO', 'REVIEW', 'READY', 'SCHEDULED', 'PUBLISHED', 'PARTIAL', 'FAILED'));

-- Existing rows that read "Failed" while a post of theirs is live
UPDATE "Content" c SET "publishingStatus" = 'PARTIAL', "stage" = 'PARTIAL'
WHERE c."publishingStatus" = 'FAILED'
  AND EXISTS (SELECT 1 FROM "PublishingSchedule" s WHERE s."contentId" = c."id" AND s."status" = 'PUBLISHED');
