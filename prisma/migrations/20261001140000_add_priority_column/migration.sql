-- AlterTable
ALTER TABLE "Board" ADD COLUMN     "priorityColumnId" TEXT;

-- AddForeignKey
ALTER TABLE "Board" ADD CONSTRAINT "Board_priorityColumnId_fkey" FOREIGN KEY ("priorityColumnId") REFERENCES "Column"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: boards that already have a column literally named "Priority"
-- (it has been in BUILT_IN_DEFAULT_COLUMNS since the project's original
-- imported sheet) get it bound automatically, the same way typeColumnId/
-- linkColumnId/predColumnId are wired up for newly created boards.
UPDATE "Board" b
SET "priorityColumnId" = c.id
FROM "Column" c
WHERE c."boardId" = b.id
  AND b."priorityColumnId" IS NULL
  AND lower(c.name) = 'priority';
