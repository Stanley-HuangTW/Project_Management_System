-- AlterTable
-- Deleting an item used to be final. It is now a trash bin: the row stays,
-- with everything hanging off it (comments, files, history), and every read
-- path filters on deletedAt IS NULL.
ALTER TABLE "Item" ADD COLUMN     "deletedAt" TIMESTAMP(3);
ALTER TABLE "Item" ADD COLUMN     "deletedById" TEXT;
-- The dependents' Pred cells as they were before the deletion rewrote them,
-- so a restore can put the dependencies back too.
ALTER TABLE "Item" ADD COLUMN     "deletedPredSnapshot" JSONB;

-- CreateIndex
CREATE INDEX "Item_boardId_deletedAt_idx" ON "Item"("boardId", "deletedAt");

-- AddForeignKey
ALTER TABLE "Item" ADD CONSTRAINT "Item_deletedById_fkey" FOREIGN KEY ("deletedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
