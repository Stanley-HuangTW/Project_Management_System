-- 預算與人力規劃改掛在「預算階段」上。
--
-- 預算是計畫,而計畫的單位是預算階段:DVT1 與 DVT2 是兩段各自要編預算的
-- 計畫,即使它們對到看板上同一列。掛在工作項上的話那兩段會擠成一筆。
-- 實際花費(Expense / Commitment)仍然留在看板工作項上 —— 錢是花在真正
-- 做的事情上,兩邊分開才比得出「估的」跟「花的」差多少。

-- ---- Budget:多一個錨點 ----
ALTER TABLE "Budget" ADD COLUMN "phaseId" TEXT;

ALTER TABLE "Budget" ADD CONSTRAINT "Budget_phaseId_fkey"
    FOREIGN KEY ("phaseId") REFERENCES "BudgetPhase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 人力表算出來的那幾筆先搬到對應的階段。一個工作項可能被兩個階段對應
-- (DVT1、DVT2 → DVT),那種情況下原本就只有一筆合併過的金額,搬給排序
-- 最前面的那一段,剩下的由 syncFromSheet 重算時補齊。
UPDATE "Budget" b
SET "phaseId" = p."id", "itemId" = NULL
FROM (
    SELECT DISTINCT ON ("itemId") "id", "itemId"
    FROM "BudgetPhase"
    WHERE "itemId" IS NOT NULL
    ORDER BY "itemId", "order"
) p
WHERE b."itemId" = p."itemId" AND b."note" = '由人力表計算';

CREATE UNIQUE INDEX "Budget_phaseId_category_key" ON "Budget"("phaseId", "category");

-- ---- LabourPlan:整個改掛階段 ----
ALTER TABLE "LabourPlan" ADD COLUMN "phaseId" TEXT;

UPDATE "LabourPlan" lp
SET "phaseId" = p."id"
FROM (
    SELECT DISTINCT ON ("itemId") "id", "itemId"
    FROM "BudgetPhase"
    WHERE "itemId" IS NOT NULL
    ORDER BY "itemId", "order"
) p
WHERE lp."itemId" = p."itemId";

-- 對不到階段的是孤兒(那個工作項沒有任何預算階段指向它),留著也沒有人讀,
-- 而且下面的 NOT NULL 會被它擋住。
DELETE FROM "LabourPlan" WHERE "phaseId" IS NULL;

ALTER TABLE "LabourPlan" ALTER COLUMN "phaseId" SET NOT NULL;

DROP INDEX IF EXISTS "LabourPlan_itemId_discipline_key";
ALTER TABLE "LabourPlan" DROP CONSTRAINT IF EXISTS "LabourPlan_itemId_fkey";
ALTER TABLE "LabourPlan" DROP COLUMN "itemId";

CREATE UNIQUE INDEX "LabourPlan_phaseId_discipline_key" ON "LabourPlan"("phaseId", "discipline");

ALTER TABLE "LabourPlan" ADD CONSTRAINT "LabourPlan_phaseId_fkey"
    FOREIGN KEY ("phaseId") REFERENCES "BudgetPhase"("id") ON DELETE CASCADE ON UPDATE CASCADE;
