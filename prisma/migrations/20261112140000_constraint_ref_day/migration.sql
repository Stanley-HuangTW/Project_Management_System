-- AlterEnum
ALTER TYPE "ItemConstraintRefEdge" ADD VALUE 'DAY';

-- AlterTable
ALTER TABLE "Item" ADD COLUMN     "constraintRefDay" INTEGER;
