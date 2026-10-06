-- 負責人欄位沒有人員分配時,預設算幾 % 的工作量(系統設定可調,0 = 不算)。
ALTER TABLE "SystemSettings" ADD COLUMN "ownerDefaultAllocationPct" INTEGER NOT NULL DEFAULT 2;
