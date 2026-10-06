-- 工時記下是從哪個外部行程(Google 日曆)匯入的,重複匯入就更新而不是重複建立。
ALTER TABLE "ActivityTimeEntry" ADD COLUMN "externalId" TEXT;

-- CreateIndex(NULL 不算重複,手動登記的工時不受影響)
CREATE UNIQUE INDEX "ActivityTimeEntry_userId_externalId_key" ON "ActivityTimeEntry"("userId", "externalId");
