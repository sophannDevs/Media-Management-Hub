-- WF-07: posts cancelled by archiving remember their status, so restoring can bring them back

-- AlterTable
ALTER TABLE "PublishingSchedule" ADD COLUMN     "archivedStatus" TEXT;

