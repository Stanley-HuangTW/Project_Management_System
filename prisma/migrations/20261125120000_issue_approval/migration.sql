-- CreateEnum
CREATE TYPE "IssueApprovalKind" AS ENUM ('CLOSE', 'TO_REPAIR', 'FIELD_TRIP');

-- CreateEnum
CREATE TYPE "IssueApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELED');

-- CreateEnum
CREATE TYPE "IssueApprovalDecision" AS ENUM ('APPROVED', 'REJECTED');

-- AlterTable
ALTER TABLE "SystemSettings" ADD COLUMN     "issueApprovalLevels" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "IssueApproval" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "kind" "IssueApprovalKind" NOT NULL,
    "status" "IssueApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "requestedById" TEXT,
    "note" TEXT NOT NULL DEFAULT '',
    "closeStatus" "IssueStatus",
    "fromStage" "IssueStage" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),

    CONSTRAINT "IssueApproval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IssueApprovalStep" (
    "id" TEXT NOT NULL,
    "approvalId" TEXT NOT NULL,
    "level" INTEGER NOT NULL,
    "approverId" TEXT,
    "decision" "IssueApprovalDecision",
    "comment" TEXT NOT NULL DEFAULT '',
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),

    CONSTRAINT "IssueApprovalStep_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "IssueApproval_caseId_createdAt_idx" ON "IssueApproval"("caseId", "createdAt");

-- CreateIndex
CREATE INDEX "IssueApproval_status_idx" ON "IssueApproval"("status");

-- CreateIndex
CREATE UNIQUE INDEX "IssueApprovalStep_approvalId_level_key" ON "IssueApprovalStep"("approvalId", "level");

-- AddForeignKey
ALTER TABLE "IssueApproval" ADD CONSTRAINT "IssueApproval_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "IssueCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssueApproval" ADD CONSTRAINT "IssueApproval_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssueApprovalStep" ADD CONSTRAINT "IssueApprovalStep_approvalId_fkey" FOREIGN KEY ("approvalId") REFERENCES "IssueApproval"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssueApprovalStep" ADD CONSTRAINT "IssueApprovalStep_approverId_fkey" FOREIGN KEY ("approverId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssueApprovalStep" ADD CONSTRAINT "IssueApprovalStep_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- 一件案件同一時間只能有一張進行中的簽核單(Prisma 的 schema 表達不了部分唯一索引,所以寫在這裡)。
CREATE UNIQUE INDEX "IssueApproval_one_pending_per_case" ON "IssueApproval"("caseId") WHERE "status" = 'PENDING';
