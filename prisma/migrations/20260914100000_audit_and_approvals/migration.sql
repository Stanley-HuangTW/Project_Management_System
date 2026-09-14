-- 稽核軌跡:活動紀錄從「只掛在工作項上」擴成也記得住板級與系統級的事件。
CREATE TYPE "AuditCategory" AS ENUM (
  'ITEM', 'BOARD', 'BASELINE', 'VISIBILITY', 'COST', 'SETTINGS', 'ACCESS', 'GATE', 'CHANGE', 'APPROVAL'
);

-- 既有的每一筆都是工作項事件,所以預設 ITEM 就是正確的回填值。
ALTER TABLE "ActivityLogEntry" ADD COLUMN "category" "AuditCategory" NOT NULL DEFAULT 'ITEM';
ALTER TABLE "ActivityLogEntry" ADD COLUMN "boardId" TEXT;
ALTER TABLE "ActivityLogEntry" ALTER COLUMN "itemId" DROP NOT NULL;

-- 既有紀錄補上看板,讓稽核頁的看板篩選對舊資料也有效。
UPDATE "ActivityLogEntry" a
SET "boardId" = i."boardId"
FROM "Item" i
WHERE a."itemId" = i."id";

CREATE INDEX "ActivityLogEntry_boardId_createdAt_idx" ON "ActivityLogEntry"("boardId", "createdAt");
CREATE INDEX "ActivityLogEntry_category_createdAt_idx" ON "ActivityLogEntry"("category", "createdAt");
ALTER TABLE "ActivityLogEntry" ADD CONSTRAINT "ActivityLogEntry_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "Board"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 工時與請假改為送審制。
CREATE TYPE "ApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- 既有資料一律視為已核准。它們是在「登記即成立」的規則下建立的,而且已經
-- 計入 EVM 的實際成本與產能判定——改成待審會讓帳上的數字無聲地少掉一截。
ALTER TABLE "TimeEntry" ADD COLUMN "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING';
ALTER TABLE "TimeEntry" ADD COLUMN "decidedById" TEXT;
ALTER TABLE "TimeEntry" ADD COLUMN "decidedAt" TIMESTAMP(3);
ALTER TABLE "TimeEntry" ADD COLUMN "decisionNote" TEXT;
UPDATE "TimeEntry" SET "status" = 'APPROVED';

ALTER TABLE "Leave" ADD COLUMN "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING';
ALTER TABLE "Leave" ADD COLUMN "decidedById" TEXT;
ALTER TABLE "Leave" ADD COLUMN "decidedAt" TIMESTAMP(3);
ALTER TABLE "Leave" ADD COLUMN "decisionNote" TEXT;
UPDATE "Leave" SET "status" = 'APPROVED';

CREATE INDEX "TimeEntry_status_idx" ON "TimeEntry"("status");
CREATE INDEX "Leave_status_idx" ON "Leave"("status");
ALTER TABLE "TimeEntry" ADD CONSTRAINT "TimeEntry_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Leave" ADD CONSTRAINT "Leave_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
