-- AlterTable
-- The saved plan each item is measured against. Copied from the item's
-- current Start/Finish/Days when a baseline is captured, and never touched by
-- scheduling afterwards — that is the whole point: the plan has to stay still
-- while the actual dates move, or "how late are we?" has no answer.
ALTER TABLE "Item" ADD COLUMN     "baselineStart" TEXT;
ALTER TABLE "Item" ADD COLUMN     "baselineEnd" TEXT;
ALTER TABLE "Item" ADD COLUMN     "baselineDays" INTEGER;

-- AlterTable
ALTER TABLE "Board" ADD COLUMN     "baselineCapturedAt" TIMESTAMP(3);
