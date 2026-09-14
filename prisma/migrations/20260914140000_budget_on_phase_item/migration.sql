-- 預算改掛在「階段那一列工作項」上,不是分組。
--
-- 在這套系統裡,分組通常就是整個專案(「AMR Platform」底下 195 項),階段
-- (POC Phase / EVT Phase)是分組裡最上層的工作項。掛在分組上的話,一個看板
-- 只會有一筆預算,分階段追蹤根本做不到。閘門本來就是掛在階段工作項上的,
-- 這一步讓兩者對齊。
--
-- 三張表都還是空的(功能剛上線、尚未有人輸入),所以直接換掉欄位即可。

ALTER TABLE "Budget" DROP CONSTRAINT IF EXISTS "Budget_groupId_fkey";
ALTER TABLE "Commitment" DROP CONSTRAINT IF EXISTS "Commitment_groupId_fkey";
ALTER TABLE "Expense" DROP CONSTRAINT IF EXISTS "Expense_groupId_fkey";
DROP INDEX IF EXISTS "Budget_groupId_category_key";
DROP INDEX IF EXISTS "Commitment_groupId_settled_idx";
DROP INDEX IF EXISTS "Expense_groupId_date_idx";

ALTER TABLE "Budget" DROP COLUMN "groupId";
ALTER TABLE "Budget" ADD COLUMN "itemId" TEXT;

ALTER TABLE "Commitment" DROP COLUMN "groupId";
ALTER TABLE "Commitment" ADD COLUMN "itemId" TEXT NOT NULL;

-- Expense already had a nullable itemId for "which task was this spent on";
-- it becomes the one and only scope, and is now required.
ALTER TABLE "Expense" DROP COLUMN "groupId";
ALTER TABLE "Expense" ALTER COLUMN "itemId" SET NOT NULL;

CREATE UNIQUE INDEX "Budget_itemId_category_key" ON "Budget"("itemId", "category");
CREATE INDEX "Commitment_itemId_settled_idx" ON "Commitment"("itemId", "settled");
CREATE INDEX "Expense_itemId_date_idx" ON "Expense"("itemId", "date");

ALTER TABLE "Budget" ADD CONSTRAINT "Budget_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Commitment" ADD CONSTRAINT "Commitment_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;
