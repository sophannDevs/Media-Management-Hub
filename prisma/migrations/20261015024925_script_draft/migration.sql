-- CreateTable
CREATE TABLE "ScriptDraft" (
    "contentId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "baseVersion" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScriptDraft_pkey" PRIMARY KEY ("contentId")
);

-- AddForeignKey
ALTER TABLE "ScriptDraft" ADD CONSTRAINT "ScriptDraft_contentId_fkey" FOREIGN KEY ("contentId") REFERENCES "Content"("id") ON DELETE CASCADE ON UPDATE CASCADE;
