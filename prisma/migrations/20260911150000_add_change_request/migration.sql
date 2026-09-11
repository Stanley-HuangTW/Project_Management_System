-- 變更單(ECR):為什麼改、誰批准、預期影響多少,以及最後是靠哪一版基準線落地的。
CREATE TYPE "ChangeStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'IMPLEMENTED', 'WITHDRAWN');

CREATE TABLE "ChangeRequest" (
    "id" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "reason" TEXT,
    "status" "ChangeStatus" NOT NULL DEFAULT 'DRAFT',
    "scheduleImpactDays" INTEGER,
    "costImpact" INTEGER,
    "impactNote" TEXT,
    "itemIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "requestedById" TEXT,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "baselineId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChangeRequest_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ChangeRequest_boardId_number_key" ON "ChangeRequest"("boardId", "number");
CREATE INDEX "ChangeRequest_boardId_status_idx" ON "ChangeRequest"("boardId", "status");

ALTER TABLE "ChangeRequest" ADD CONSTRAINT "ChangeRequest_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "Board"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ChangeRequest" ADD CONSTRAINT "ChangeRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ChangeRequest" ADD CONSTRAINT "ChangeRequest_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ChangeRequest" ADD CONSTRAINT "ChangeRequest_baselineId_fkey" FOREIGN KEY ("baselineId") REFERENCES "Baseline"("id") ON DELETE SET NULL ON UPDATE CASCADE;
