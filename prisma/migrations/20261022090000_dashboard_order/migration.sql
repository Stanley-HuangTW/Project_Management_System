-- AlterTable
ALTER TABLE "User" ADD COLUMN     "dashboardOrder" TEXT[] DEFAULT ARRAY[]::TEXT[];
