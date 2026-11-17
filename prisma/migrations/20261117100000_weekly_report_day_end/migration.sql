-- AlterTable
ALTER TABLE "SystemSettings" ADD COLUMN     "weeklyReportDayEndHour" INTEGER NOT NULL DEFAULT 18,
ADD COLUMN     "weeklyReportDayEndMinute" INTEGER NOT NULL DEFAULT 0;
