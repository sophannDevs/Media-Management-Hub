-- AlterTable
ALTER TABLE "MediaAsset" ADD COLUMN     "codec" TEXT,
ADD COLUMN     "container" TEXT,
ADD COLUMN     "probedAt" TIMESTAMP(3),
ADD COLUMN     "sha256" TEXT;

-- CreateIndex
CREATE INDEX "MediaAsset_sha256_idx" ON "MediaAsset"("sha256");

