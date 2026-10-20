-- AlterTable
ALTER TABLE "SystemSettings" ADD COLUMN     "weeklyReportReminderHours" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "weeklyReportReminderLastWeek" TEXT;
