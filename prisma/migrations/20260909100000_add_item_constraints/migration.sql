-- CreateEnum
CREATE TYPE "ItemConstraintType" AS ENUM ('START_NO_EARLIER_THAN', 'FINISH_NO_LATER_THAN', 'MUST_FINISH_ON');

-- AlterTable
-- A date the schedule has to respect regardless of what the Pred chain wants:
-- a part that does not arrive until the 15th, a customer demo that cannot move.
ALTER TABLE "Item" ADD COLUMN     "constraintType" "ItemConstraintType";
ALTER TABLE "Item" ADD COLUMN     "constraintDate" TEXT;
