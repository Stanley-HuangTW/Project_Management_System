-- AlterTable
ALTER TABLE "Board" ADD COLUMN     "bomColumns" JSONB;

-- AlterTable
ALTER TABLE "BomLine" ADD COLUMN     "extra" JSONB NOT NULL DEFAULT '{}';

-- AlterTable
ALTER TABLE "SystemSettings" ADD COLUMN     "bomDefaultColumns" JSONB;
