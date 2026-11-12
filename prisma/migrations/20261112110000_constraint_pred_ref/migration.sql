-- CreateEnum
CREATE TYPE "ItemConstraintRefEdge" AS ENUM ('START', 'FINISH');

-- AlterTable
ALTER TABLE "Item" ADD COLUMN     "constraintRefEdge" "ItemConstraintRefEdge",
ADD COLUMN     "constraintRefItemId" TEXT;
