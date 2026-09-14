-- 報價單、發票、簽了的 PO:讓附件也能掛在一筆支出或一張訂單上。
--
-- 沿用既有的 Attachment,而不是另開一張表——上傳、下載授權(透過 itemId 查看板)
-- 與檔案存放位置都已經是對的,只差「這個檔案是哪一筆帳的憑證」這個欄位。
ALTER TABLE "Attachment" ADD COLUMN "expenseId" TEXT;
ALTER TABLE "Attachment" ADD COLUMN "commitmentId" TEXT;

CREATE INDEX "Attachment_expenseId_idx" ON "Attachment"("expenseId");
CREATE INDEX "Attachment_commitmentId_idx" ON "Attachment"("commitmentId");

ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "Expense"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_commitmentId_fkey" FOREIGN KEY ("commitmentId") REFERENCES "Commitment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
