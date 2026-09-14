-- 多幣別:國外供應商的 PO 與支出。
--
-- amount 仍然是「換算後的台幣」,所以每一個既有的加總、預算判定、預估都不必
-- 改。新增的三欄記的是「原本是多少外幣、用什麼匯率換的」,而匯率是凍結的——
-- 跟著今天匯率浮動的話,上個月結的帳下個月就變成另一個數字。
CREATE TABLE "ExchangeRate" (
    "code" TEXT NOT NULL,
    "rate" DECIMAL(12,4) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" TEXT,

    CONSTRAINT "ExchangeRate_pkey" PRIMARY KEY ("code")
);

ALTER TABLE "Commitment" ADD COLUMN "currency" TEXT NOT NULL DEFAULT 'TWD';
ALTER TABLE "Commitment" ADD COLUMN "originalAmount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Commitment" ADD COLUMN "fxRate" DECIMAL(12,4) NOT NULL DEFAULT 1;

ALTER TABLE "Expense" ADD COLUMN "currency" TEXT NOT NULL DEFAULT 'TWD';
ALTER TABLE "Expense" ADD COLUMN "originalAmount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Expense" ADD COLUMN "fxRate" DECIMAL(12,4) NOT NULL DEFAULT 1;

-- 既有的每一筆都是台幣,原始金額就是它自己。
UPDATE "Commitment" SET "originalAmount" = "amount";
UPDATE "Expense" SET "originalAmount" = "amount";
