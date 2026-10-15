-- AlterTable
ALTER TABLE "PublishingJob" ADD COLUMN     "durationMs" INTEGER,
ADD COLUMN     "externalId" TEXT,
ADD COLUMN     "platformRequestId" TEXT,
ADD COLUMN     "retryAt" TIMESTAMP(3),
ADD COLUMN     "retryReason" TEXT,
ADD COLUMN     "trigger" TEXT NOT NULL DEFAULT 'SCHEDULED',
ADD COLUMN     "workerId" TEXT;

-- AlterTable
ALTER TABLE "PublishingSchedule" ADD COLUMN     "autoRetries" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "platformStatus" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "PublishingJob_scheduleId_attempt_key" ON "PublishingJob"("scheduleId", "attempt");


-- PUB-09 / ARCH-02 (hand-written; Prisma can't express these).
ALTER TABLE "PublishingJob" ADD CONSTRAINT "PublishingJob_trigger_check" CHECK ("trigger" IN ('SCHEDULED', 'RETRY', 'MANUAL'));
ALTER TABLE "PublishingJob" ADD CONSTRAINT "PublishingJob_durationMs_check" CHECK ("durationMs" IS NULL OR "durationMs" >= 0);
ALTER TABLE "PublishingSchedule" ADD CONSTRAINT "PublishingSchedule_platformStatus_check" CHECK ("platformStatus" IS NULL OR "platformStatus" IN ('UPLOADING', 'PROCESSING', 'LIVE', 'REJECTED'));
ALTER TABLE "PublishingSchedule" ADD CONSTRAINT "PublishingSchedule_autoRetries_check" CHECK ("autoRetries" >= 0);

-- An attempt is written once: created when it starts, finished once. A finished row never changes.
CREATE OR REPLACE FUNCTION publishing_job_append_only() RETURNS trigger AS $$
BEGIN
  IF OLD."finishedAt" IS NOT NULL THEN
    RAISE EXCEPTION 'PublishingJob %: a finished attempt is never changed', OLD."id" USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$ LANGUAGE plpgsql;
CREATE TRIGGER "PublishingJob_append_only" BEFORE UPDATE ON "PublishingJob" FOR EACH ROW EXECUTE FUNCTION publishing_job_append_only();

-- The schedule's state machine (src/lib/workflow/schedule-machine.ts). Same status: always allowed.
CREATE OR REPLACE FUNCTION publishing_schedule_transition() RETURNS trigger AS $$
BEGIN
  IF NEW."status" = OLD."status" THEN RETURN NEW; END IF;
  IF (OLD."status" = 'WAITING'         AND NEW."status" IN ('PROCESSING', 'CANCELLED'))
  OR (OLD."status" = 'PROCESSING'      AND NEW."status" IN ('PUBLISHED', 'RETRY_SCHEDULED', 'FAILED'))
  OR (OLD."status" = 'RETRY_SCHEDULED' AND NEW."status" IN ('PROCESSING', 'WAITING', 'CANCELLED'))
  OR (OLD."status" = 'FAILED'          AND NEW."status" IN ('RETRY_SCHEDULED', 'WAITING', 'CANCELLED'))
  OR (OLD."status" = 'CANCELLED'       AND NEW."status" IN ('WAITING', 'RETRY_SCHEDULED'))
  THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'PublishingSchedule %: status % cannot become %', OLD."id", OLD."status", NEW."status" USING ERRCODE = 'check_violation';
END
$$ LANGUAGE plpgsql;
CREATE TRIGGER "PublishingSchedule_status_transition" BEFORE UPDATE OF "status" ON "PublishingSchedule" FOR EACH ROW EXECUTE FUNCTION publishing_schedule_transition();
