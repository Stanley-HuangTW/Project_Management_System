-- 新看板要帶哪些欄位。NULL = 沒有設定過,沿用程式內建的那一份。
ALTER TABLE "SystemSettings" ADD COLUMN "defaultColumns" JSONB;
