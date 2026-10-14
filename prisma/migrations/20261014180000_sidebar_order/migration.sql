-- AlterTable
ALTER TABLE "User" ADD COLUMN     "boardOrder" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "programOrder" TEXT[] DEFAULT ARRAY[]::TEXT[];
