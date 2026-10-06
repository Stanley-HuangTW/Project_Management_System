-- 週報涵蓋的日期範圍:從星期幾到星期幾,預設週三到週二(0=週日 … 6=週六)。
ALTER TABLE "SystemSettings"
  ADD COLUMN "weeklyReportRangeStartDow" INTEGER NOT NULL DEFAULT 3,
  ADD COLUMN "weeklyReportRangeEndDow" INTEGER NOT NULL DEFAULT 2;
