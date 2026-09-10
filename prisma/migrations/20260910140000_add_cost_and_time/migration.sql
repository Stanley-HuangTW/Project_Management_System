-- AlterTable
-- 每小時人力成本,跟著人走。
ALTER TABLE "User" ADD COLUMN     "hourlyRate" DECIMAL(12,2);

-- AlterTable
-- 直接費用(NRE/BOM/外包),與人力成本分開記。
ALTER TABLE "Item" ADD COLUMN     "budgetCost" INTEGER;
ALTER TABLE "Item" ADD COLUMN     "actualCost" INTEGER;

-- AlterTable
-- 一天算幾小時:把「配置 50%、做 10 天」換算成工時與成本的係數。
ALTER TABLE "SystemSettings" ADD COLUMN     "hoursPerDay" INTEGER NOT NULL DEFAULT 8;

-- CreateTable
-- 實際工時:一個人、一個工作項、一天。
CREATE TABLE "TimeEntry" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "hours" DECIMAL(6,2) NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TimeEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TimeEntry_itemId_idx" ON "TimeEntry"("itemId");
CREATE INDEX "TimeEntry_userId_date_idx" ON "TimeEntry"("userId", "date");

-- AddForeignKey
ALTER TABLE "TimeEntry" ADD CONSTRAINT "TimeEntry_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TimeEntry" ADD CONSTRAINT "TimeEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
