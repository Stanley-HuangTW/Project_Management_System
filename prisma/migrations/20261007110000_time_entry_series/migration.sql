-- 工時的「重複」:一次建立的一批工時共用 seriesId,可以一次刪掉某一筆之後的整批。
ALTER TABLE "TimeEntry" ADD COLUMN "seriesId" TEXT;
ALTER TABLE "ActivityTimeEntry" ADD COLUMN "seriesId" TEXT;

-- CreateIndex
CREATE INDEX "TimeEntry_seriesId_idx" ON "TimeEntry"("seriesId");

-- CreateIndex
CREATE INDEX "ActivityTimeEntry_seriesId_idx" ON "ActivityTimeEntry"("seriesId");
