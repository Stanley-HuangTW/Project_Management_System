-- AlterTable
ALTER TABLE "SystemSettings" ADD COLUMN     "weeklyReportLastRunAt" TIMESTAMP(3),
ADD COLUMN     "weeklyReportLastRunNote" TEXT;
