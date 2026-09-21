-- 準備金也掛到預算階段上。
--
-- 預算(Budget)在上一支 migration 已經搬到階段了,準備金留在工作項上的話,
-- 同一個面板會有一半的數字問階段、一半問工作項 —— 動支會把額度撥進「這個
-- 範圍」的類別預算,兩邊指的範圍不一樣就會撥錯地方。
--
-- 既有資料不動:itemId / programId 上的準備金照舊,phaseId 是新增的第三種掛法。

ALTER TABLE "Reserve" ADD COLUMN "phaseId" TEXT;

ALTER TABLE "Reserve"
  ADD CONSTRAINT "Reserve_phaseId_fkey"
  FOREIGN KEY ("phaseId") REFERENCES "BudgetPhase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX "Reserve_phaseId_kind_key" ON "Reserve"("phaseId", "kind");
