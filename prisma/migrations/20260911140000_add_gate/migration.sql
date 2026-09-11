-- 階段閘門:POC/EVT/PVT 這些階段的出口審查,以及誰放行的紀錄。
CREATE TYPE "GateStatus" AS ENUM ('DRAFT', 'PENDING', 'PASSED', 'FAILED', 'WAIVED');
CREATE TYPE "GateDecision" AS ENUM ('APPROVED', 'REJECTED');

CREATE TABLE "Gate" (
    "id" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "itemId" TEXT,
    "name" TEXT NOT NULL,
    "status" "GateStatus" NOT NULL DEFAULT 'DRAFT',
    "plannedDate" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decidedById" TEXT,
    "decisionNote" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Gate_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "GateCriterion" (
    "id" TEXT NOT NULL,
    "gateId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT true,
    "met" BOOLEAN NOT NULL DEFAULT false,
    "itemId" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "GateCriterion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "GateApprover" (
    "id" TEXT NOT NULL,
    "gateId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "decision" "GateDecision",
    "decidedAt" TIMESTAMP(3),
    "comment" TEXT,

    CONSTRAINT "GateApprover_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Gate_boardId_status_idx" ON "Gate"("boardId", "status");
CREATE INDEX "GateCriterion_gateId_idx" ON "GateCriterion"("gateId");
CREATE INDEX "GateApprover_gateId_idx" ON "GateApprover"("gateId");
CREATE UNIQUE INDEX "GateApprover_gateId_userId_key" ON "GateApprover"("gateId", "userId");

ALTER TABLE "Gate" ADD CONSTRAINT "Gate_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "Board"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Gate" ADD CONSTRAINT "Gate_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "GateCriterion" ADD CONSTRAINT "GateCriterion_gateId_fkey" FOREIGN KEY ("gateId") REFERENCES "Gate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GateApprover" ADD CONSTRAINT "GateApprover_gateId_fkey" FOREIGN KEY ("gateId") REFERENCES "Gate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GateApprover" ADD CONSTRAINT "GateApprover_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
