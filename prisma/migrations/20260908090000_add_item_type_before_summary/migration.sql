-- AlterTable
-- Remembers the Type option an item had before gaining its first child forced
-- it to Summary, so removing the last child can put it back. An empty string
-- means "it had no Type at all"; NULL means it was never flipped.
ALTER TABLE "Item" ADD COLUMN     "typeBeforeSummary" TEXT;
