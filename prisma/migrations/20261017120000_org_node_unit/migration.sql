-- AlterTable
ALTER TABLE "OrgNode" ADD COLUMN     "unitCode" TEXT;

-- AddForeignKey
ALTER TABLE "OrgNode" ADD CONSTRAINT "OrgNode_unitCode_fkey" FOREIGN KEY ("unitCode") REFERENCES "OrgUnit"("code") ON DELETE SET NULL ON UPDATE CASCADE;
