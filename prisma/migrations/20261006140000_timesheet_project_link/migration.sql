-- 工時:非專案工時可以對應專案(要主管核准才計入專案成本)、行事曆用的開始時間、新的工時類別。

-- AlterTable
ALTER TABLE "User" ADD COLUMN "timesheetNoApproval" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "TimeCategory" ADD COLUMN "allowProject" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "TimeEntry" ADD COLUMN "startMinute" INTEGER;

-- AlterTable(既有的非專案工時都是登記即生效,所以 status 預設 APPROVED)
ALTER TABLE "ActivityTimeEntry"
  ADD COLUMN "startMinute" INTEGER,
  ADD COLUMN "boardId" TEXT,
  ADD COLUMN "status" "ApprovalStatus" NOT NULL DEFAULT 'APPROVED',
  ADD COLUMN "decidedById" TEXT,
  ADD COLUMN "decidedAt" TIMESTAMP(3),
  ADD COLUMN "decisionNote" TEXT;

-- CreateIndex
CREATE INDEX "ActivityTimeEntry_boardId_status_idx" ON "ActivityTimeEntry"("boardId", "status");

-- AddForeignKey
ALTER TABLE "ActivityTimeEntry" ADD CONSTRAINT "ActivityTimeEntry_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "Board"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 部門週會、公司專案週會、請假不屬於任何專案;出差、出差交通可以對應專案。
INSERT INTO "TimeCategory" ("id", "name", "order", "active", "linkIssue", "allowProject", "createdAt") VALUES
  ('timecat_dept_meeting', '部門週會', 100, true, false, false, CURRENT_TIMESTAMP),
  ('timecat_company_meeting', '公司專案週會', 101, true, false, false, CURRENT_TIMESTAMP),
  ('timecat_leave', '請假', 102, true, false, false, CURRENT_TIMESTAMP),
  ('timecat_trip', '出差', 103, true, false, true, CURRENT_TIMESTAMP),
  ('timecat_trip_travel', '出差交通', 104, true, false, true, CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO NOTHING;
