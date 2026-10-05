-- AlterTable
ALTER TABLE "User" ADD COLUMN "canViewAllTimesheets" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "TimeCategory" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "linkIssue" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TimeCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActivityTimeEntry" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "hours" DECIMAL(6,2) NOT NULL,
    "categoryId" TEXT NOT NULL,
    "note" TEXT,
    "riskEntryId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActivityTimeEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TimeCategory_name_key" ON "TimeCategory"("name");

-- CreateIndex
CREATE INDEX "ActivityTimeEntry_userId_date_idx" ON "ActivityTimeEntry"("userId", "date");

-- CreateIndex
CREATE INDEX "ActivityTimeEntry_date_idx" ON "ActivityTimeEntry"("date");

-- AddForeignKey
ALTER TABLE "ActivityTimeEntry" ADD CONSTRAINT "ActivityTimeEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityTimeEntry" ADD CONSTRAINT "ActivityTimeEntry_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "TimeCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityTimeEntry" ADD CONSTRAINT "ActivityTimeEntry_riskEntryId_fkey" FOREIGN KEY ("riskEntryId") REFERENCES "RiskEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 預設類別。固定 id 讓這支 migration 在每個環境產生同樣的資料。
INSERT INTO "TimeCategory" ("id", "name", "order", "active", "linkIssue") VALUES
    ('timecat_meeting',  '例行會議',     0, true, false),
    ('timecat_issue',    '突發問題處理', 1, true, true),
    ('timecat_training', '教育訓練',     2, true, false),
    ('timecat_admin',    '行政事務',     3, true, false),
    ('timecat_other',    '其他',         4, true, false);
