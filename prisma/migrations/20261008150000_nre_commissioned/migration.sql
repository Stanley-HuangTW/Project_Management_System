-- NRE 報價單多一類「委託開發」:委託單位、委託項目、時間範圍,掛在某個階段或涵蓋整個專案。
ALTER TYPE "NreCategory" ADD VALUE 'COMMISSIONED';

-- 每一列帶 boardId(涵蓋整個專案的列沒有階段,整個專案的合計靠 boardId 找得到);
-- 先加成可以空的、用階段補上現有的列,再改成必填。
ALTER TABLE "NreLine" ADD COLUMN "boardId" TEXT,
ADD COLUMN "endDate" TEXT,
ADD COLUMN "startDate" TEXT;

UPDATE "NreLine"
SET "boardId" = (SELECT "boardId" FROM "BudgetPhase" WHERE "BudgetPhase"."id" = "NreLine"."phaseId");

ALTER TABLE "NreLine" ALTER COLUMN "boardId" SET NOT NULL,
ALTER COLUMN "phaseId" DROP NOT NULL;

CREATE INDEX "NreLine_boardId_category_order_idx" ON "NreLine"("boardId", "category", "order");

ALTER TABLE "NreLine" ADD CONSTRAINT "NreLine_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "Board"("id") ON DELETE CASCADE ON UPDATE CASCADE;
