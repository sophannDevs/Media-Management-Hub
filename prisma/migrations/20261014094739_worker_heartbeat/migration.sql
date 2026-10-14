-- PUB-10/PUB-11: worker heartbeats and once-per-period jobs

-- CreateTable
CREATE TABLE "WorkerHeartbeat" (
    "id" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastBeatAt" TIMESTAMP(3) NOT NULL,
    "lastTickAt" TIMESTAMP(3),
    "lastTickMs" INTEGER,
    "processed" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "WorkerHeartbeat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScheduledTask" (
    "name" TEXT NOT NULL,
    "lastStartedAt" TIMESTAMP(3),
    "lastFinishedAt" TIMESTAMP(3),
    "lastDurationMs" INTEGER,
    "lastError" TEXT,

    CONSTRAINT "ScheduledTask_pkey" PRIMARY KEY ("name")
);

-- CreateIndex
CREATE INDEX "WorkerHeartbeat_lastBeatAt_idx" ON "WorkerHeartbeat"("lastBeatAt");

