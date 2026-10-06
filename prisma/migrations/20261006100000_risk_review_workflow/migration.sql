-- 風險與議題的審核流程:負責人申請結案 → 全部審核人同意才結案;進度更新時間軸;操作紀錄。

-- AlterEnum
ALTER TYPE "RiskStatus" ADD VALUE 'PENDING_REVIEW';

-- AlterEnum
ALTER TYPE "AuditCategory" ADD VALUE 'RISK';

-- AlterTable
ALTER TABLE "ActivityLogEntry" ADD COLUMN "riskId" TEXT;

-- CreateTable
CREATE TABLE "RiskReviewer" (
    "id" TEXT NOT NULL,
    "riskId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "approvedAt" TIMESTAMP(3),

    CONSTRAINT "RiskReviewer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiskUpdate" (
    "id" TEXT NOT NULL,
    "riskId" TEXT NOT NULL,
    "authorId" TEXT,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RiskUpdate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RiskReviewer_riskId_userId_key" ON "RiskReviewer"("riskId", "userId");

-- CreateIndex
CREATE INDEX "RiskReviewer_userId_idx" ON "RiskReviewer"("userId");

-- CreateIndex
CREATE INDEX "RiskUpdate_riskId_createdAt_idx" ON "RiskUpdate"("riskId", "createdAt");

-- CreateIndex
CREATE INDEX "ActivityLogEntry_riskId_idx" ON "ActivityLogEntry"("riskId");

-- AddForeignKey
ALTER TABLE "ActivityLogEntry" ADD CONSTRAINT "ActivityLogEntry_riskId_fkey" FOREIGN KEY ("riskId") REFERENCES "RiskEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiskReviewer" ADD CONSTRAINT "RiskReviewer_riskId_fkey" FOREIGN KEY ("riskId") REFERENCES "RiskEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiskReviewer" ADD CONSTRAINT "RiskReviewer_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiskUpdate" ADD CONSTRAINT "RiskUpdate_riskId_fkey" FOREIGN KEY ("riskId") REFERENCES "RiskEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiskUpdate" ADD CONSTRAINT "RiskUpdate_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
