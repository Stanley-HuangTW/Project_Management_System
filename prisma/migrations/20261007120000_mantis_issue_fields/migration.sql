-- Issue 分頁要顯示的 Mantis 欄位:嚴重度、優先權、分類、回報人。
ALTER TABLE "RiskEntry"
  ADD COLUMN "mantisSeverity" TEXT,
  ADD COLUMN "mantisPriority" TEXT,
  ADD COLUMN "mantisCategory" TEXT,
  ADD COLUMN "mantisReporter" TEXT;
