-- WF-03: store the derived stage, missing requirements, completion and cover image on Content

-- DropIndex
DROP INDEX "Content_archivedAt_idx";

-- AlterTable
ALTER TABLE "Content" ADD COLUMN     "completion" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "coverAssetId" TEXT,
ADD COLUMN     "missingMask" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "stage" TEXT NOT NULL DEFAULT 'IDEA';

-- CreateIndex
CREATE INDEX "Content_archivedAt_stage_updatedAt_idx" ON "Content"("archivedAt", "stage", "updatedAt");

-- CreateIndex
CREATE INDEX "Content_coverAssetId_idx" ON "Content"("coverAssetId");

-- AddForeignKey
ALTER TABLE "Content" ADD CONSTRAINT "Content_coverAssetId_fkey" FOREIGN KEY ("coverAssetId") REFERENCES "MediaAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: the same derivation as deriveContentState() in src/lib/workflow/rules.ts,
-- with the workflow rules saved in Settings (defaults when there is no settings row).
-- The stage builds on the stored publishingStatus, which syncPublishingStatus() keeps current.
-- tests/integration/content-state.test.ts runs this statement and compares it with the code.
WITH r AS (
  SELECT
    COALESCE(s."requireScriptApproved", true) AS script,
    COALESCE(s."requireImagesApproved", true) AS images,
    COALESCE(s."requireFinalVideo", true) AS video,
    COALESCE(s."requireReview", true) AS review,
    COALESCE(s."requireThumbnail", false) AS thumbnail
  FROM (SELECT 1) AS one LEFT JOIN "WorkspaceSettings" s ON s."id" = 1
),
f AS (
  SELECT
    c."id",
    (SELECT COUNT(*) FROM "MediaAsset" m WHERE m."contentId" = c."id" AND m."type" = 'IMAGE') AS images,
    (SELECT COUNT(*) FROM "MediaAsset" m WHERE m."contentId" = c."id" AND m."type" = 'IMAGE' AND m."isSelected") AS selected,
    (SELECT m."id" FROM "MediaAsset" m WHERE m."contentId" = c."id" AND m."type" = 'IMAGE'
      ORDER BY m."isSelected" DESC, m."createdAt", m."id" LIMIT 1) AS first_image,
    EXISTS (SELECT 1 FROM "PublishingSchedule" p WHERE p."contentId" = c."id" AND p."status" <> 'CANCELLED') AS scheduled,
    COALESCE((SELECT s."body" ~ '\S' FROM "Script" s WHERE s."contentId" = c."id"), false) AS has_script,
    COALESCE((SELECT p."prompt" ~ '\S' FROM "ImagePrompt" p WHERE p."contentId" = c."id"), false) AS has_prompt
  FROM "Content" c
),
m AS (
  SELECT
    c."id",
      (CASE WHEN c."videoAssetId" IS NULL THEN 1 ELSE 0 END)
    + (CASE WHEN r.script AND c."scriptStatus" <> 'APPROVED' THEN 2 ELSE 0 END)
    + (CASE WHEN r.images AND c."imageStatus" <> 'APPROVED' THEN 4 ELSE 0 END)
    + (CASE WHEN r.images AND c."imageStatus" = 'APPROVED' AND f.selected = 0 THEN 8 ELSE 0 END)
    + (CASE WHEN r.video AND c."videoAssetId" IS NOT NULL AND c."videoStatus" <> 'FINAL' THEN 16 ELSE 0 END)
    + (CASE WHEN r.review AND c."reviewStatus" <> 'APPROVED' THEN 32 ELSE 0 END)
    + (CASE WHEN r.thumbnail AND c."thumbnailAssetId" IS NULL THEN 64 ELSE 0 END) AS mask
  FROM "Content" c JOIN f ON f."id" = c."id" CROSS JOIN r
)
UPDATE "Content" c SET
  "missingMask" = m.mask,
  "stage" = CASE
    WHEN c."publishingStatus" = 'PUBLISHED' THEN 'PUBLISHED'
    WHEN c."publishingStatus" = 'FAILED' THEN 'FAILED'
    WHEN c."publishingStatus" IN ('SCHEDULED', 'PUBLISHING') THEN 'SCHEDULED'
    WHEN c."scriptStatus" = 'NOT_STARTED' THEN 'IDEA'
    WHEN r.script AND c."scriptStatus" <> 'APPROVED' THEN 'SCRIPT'
    WHEN r.images AND c."imageStatus" <> 'APPROVED' THEN 'IMAGES'
    WHEN r.video AND c."videoStatus" <> 'FINAL' THEN 'VIDEO'
    WHEN r.review AND c."reviewStatus" <> 'APPROVED' THEN 'REVIEW'
    WHEN m.mask = 0 THEN 'READY'
    ELSE 'VIDEO'
  END,
  -- 13 checklist items, see checklist()
  "completion" = round((
      1
    + f.has_script::int
    + (c."scriptStatus" = 'APPROVED')::int
    + f.has_prompt::int
    + (f.images > 0 OR c."imageStatus" IN ('GENERATED', 'NEEDS_REVISION', 'APPROVED'))::int
    + (f.selected > 0 OR c."imageStatus" = 'APPROVED')::int
    + (c."videoAssetId" IS NOT NULL)::int
    + (c."thumbnailAssetId" IS NOT NULL)::int
    + c."titleFinalized"::int
    + c."descriptionFinalized"::int
    + (c."hashtags" ~ '\S')::int
    + (c."reviewStatus" = 'APPROVED')::int
    + f.scheduled::int
  ) * 100.0 / 13),
  "coverAssetId" = COALESCE(c."thumbnailAssetId", f.first_image)
FROM f JOIN m ON m."id" = f."id" CROSS JOIN r
WHERE c."id" = f."id";
