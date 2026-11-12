-- CreateTable
CREATE TABLE "GateCriterionApprover" (
    "id" TEXT NOT NULL,
    "criterionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "decision" "GateDecision",
    "decidedAt" TIMESTAMP(3),
    "comment" TEXT,

    CONSTRAINT "GateCriterionApprover_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GateCriterionApprover_criterionId_idx" ON "GateCriterionApprover"("criterionId");

-- CreateIndex
CREATE INDEX "GateCriterionApprover_userId_idx" ON "GateCriterionApprover"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "GateCriterionApprover_criterionId_userId_key" ON "GateCriterionApprover"("criterionId", "userId");

-- AddForeignKey
ALTER TABLE "GateCriterionApprover" ADD CONSTRAINT "GateCriterionApprover_criterionId_fkey" FOREIGN KEY ("criterionId") REFERENCES "GateCriterion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GateCriterionApprover" ADD CONSTRAINT "GateCriterionApprover_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
