-- AlterTable
ALTER TABLE "Content" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "trashedFromArchive" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "Content_deletedAt_idx" ON "Content"("deletedAt");

