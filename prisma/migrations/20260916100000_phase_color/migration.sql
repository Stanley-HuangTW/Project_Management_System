-- 階段帶原本一律同色,兩個階段挨在一起就糊成一條。里程碑早就有 color 了,
-- 階段補上同樣的欄位。
ALTER TABLE "BudgetPhase" ADD COLUMN "color" TEXT NOT NULL DEFAULT '#fdab3d';
