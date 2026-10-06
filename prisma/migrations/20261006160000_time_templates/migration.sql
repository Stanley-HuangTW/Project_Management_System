-- 工時範本:例行會議等重複登記的工時(個人範本 + 管理者建立的共用範本)。

-- CreateTable
CREATE TABLE "TimeTemplate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ownerId" TEXT,
    "categoryId" TEXT,
    "itemId" TEXT,
    "boardId" TEXT,
    "startMinute" INTEGER,
    "hours" DECIMAL(6,2) NOT NULL,
    "note" TEXT,
    "weekdays" INTEGER[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TimeTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TimeTemplate_ownerId_idx" ON "TimeTemplate"("ownerId");

-- AddForeignKey
ALTER TABLE "TimeTemplate" ADD CONSTRAINT "TimeTemplate_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeTemplate" ADD CONSTRAINT "TimeTemplate_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "TimeCategory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeTemplate" ADD CONSTRAINT "TimeTemplate_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeTemplate" ADD CONSTRAINT "TimeTemplate_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "Board"("id") ON DELETE SET NULL ON UPDATE CASCADE;
