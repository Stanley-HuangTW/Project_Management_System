-- CreateEnum
CREATE TYPE "IssueShipMethod" AS ENUM ('MAIL', 'HAND');

-- AlterTable
ALTER TABLE "IssueCase" ADD COLUMN     "accessories" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "onsiteReplace" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "receivedDate" TEXT,
ADD COLUMN     "repairDoneDate" TEXT,
ADD COLUMN     "repairStartDate" TEXT,
ADD COLUMN     "shipMethod" "IssueShipMethod",
ADD COLUMN     "shippedDate" TEXT,
ADD COLUMN     "trackingNo" TEXT;

