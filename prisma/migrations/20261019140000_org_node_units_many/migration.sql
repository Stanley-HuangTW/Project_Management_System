-- CreateTable
CREATE TABLE "OrgNodeUnit" (
    "nodeId" TEXT NOT NULL,
    "unitCode" TEXT NOT NULL,

    CONSTRAINT "OrgNodeUnit_pkey" PRIMARY KEY ("nodeId","unitCode")
);

-- CreateIndex
CREATE INDEX "OrgNodeUnit_unitCode_idx" ON "OrgNodeUnit"("unitCode");

-- AddForeignKey
ALTER TABLE "OrgNodeUnit" ADD CONSTRAINT "OrgNodeUnit_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "OrgNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrgNodeUnit" ADD CONSTRAINT "OrgNodeUnit_unitCode_fkey" FOREIGN KEY ("unitCode") REFERENCES "OrgUnit"("code") ON DELETE CASCADE ON UPDATE CASCADE;

-- Carry over the existing one-unit-per-node mappings (OrgNode.unitCode) into the new many-to-many table, then drop the old column.
INSERT INTO "OrgNodeUnit" ("nodeId", "unitCode")
SELECT "id", "unitCode" FROM "OrgNode" WHERE "unitCode" IS NOT NULL;

-- DropForeignKey
ALTER TABLE "OrgNode" DROP CONSTRAINT "OrgNode_unitCode_fkey";

-- AlterTable
ALTER TABLE "OrgNode" DROP COLUMN "unitCode";
