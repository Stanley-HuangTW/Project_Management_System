-- 專案工時多記一欄「預估時數」:從工作項預估匯入的工時,記下當初的預估(實際時數可以再改),畫面並排顯示預估與實際。
ALTER TABLE "TimeEntry" ADD COLUMN "estimateHours" DECIMAL(6,2);
