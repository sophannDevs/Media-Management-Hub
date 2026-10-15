-- AlterTable
ALTER TABLE "MediaAsset" ADD COLUMN     "deriveError" TEXT,
ADD COLUMN     "derivedAt" TIMESTAMP(3),
ADD COLUMN     "variants" JSONB;

-- CreateIndex
CREATE INDEX "MediaAsset_derivedAt_idx" ON "MediaAsset"("derivedAt");

