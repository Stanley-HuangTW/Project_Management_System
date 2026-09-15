-- AlterTable
-- Deleting a board used to be final — no trash, unlike items. Two boards were
-- destroyed that way and could not be recovered from any backup. The row now
-- stays, with its groups, columns, items, budgets and baselines hanging off it,
-- and every list, search, schedule network and programme rollup filters on
-- deletedAt IS NULL. Only an admin can purge one for good.
ALTER TABLE "Board" ADD COLUMN     "deletedAt" TIMESTAMP(3);
ALTER TABLE "Board" ADD COLUMN     "deletedById" TEXT;

-- CreateIndex
CREATE INDEX "Board_deletedAt_idx" ON "Board"("deletedAt");

-- AddForeignKey
ALTER TABLE "Board" ADD CONSTRAINT "Board_deletedById_fkey" FOREIGN KEY ("deletedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
