-- CreateEnum
CREATE TYPE "RiskKind" AS ENUM ('RISK', 'ISSUE');
CREATE TYPE "RiskStatus" AS ENUM ('OPEN', 'MITIGATING', 'CLOSED');

-- CreateTable
-- The Risk/Issue register: what could go wrong, how bad, who is on it.
CREATE TABLE "RiskEntry" (
    "id" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "kind" "RiskKind" NOT NULL DEFAULT 'RISK',
    "status" "RiskStatus" NOT NULL DEFAULT 'OPEN',
    "title" TEXT NOT NULL,
    "description" TEXT,
    "probability" INTEGER NOT NULL DEFAULT 3,
    "impact" INTEGER NOT NULL DEFAULT 3,
    "mitigation" TEXT,
    "ownerId" TEXT,
    "dueDate" TEXT,
    "itemId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RiskEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RiskEntry_boardId_status_idx" ON "RiskEntry"("boardId", "status");

-- AddForeignKey
ALTER TABLE "RiskEntry" ADD CONSTRAINT "RiskEntry_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "Board"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RiskEntry" ADD CONSTRAINT "RiskEntry_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
