-- AlterTable
ALTER TABLE "MantisConnection" ADD COLUMN     "mapping" JSONB,
ADD COLUMN     "users" JSONB;

-- AlterTable
ALTER TABLE "RiskEntry" ADD COLUMN     "mantisHandlerId" INTEGER,
ADD COLUMN     "mantisPriorityId" INTEGER,
ADD COLUMN     "mantisSeverityId" INTEGER,
ADD COLUMN     "mantisStatusId" INTEGER;
