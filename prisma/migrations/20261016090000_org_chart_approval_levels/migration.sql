-- CreateEnum
CREATE TYPE "ApprovalKind" AS ENUM ('TIME', 'ACTIVITY', 'LEAVE');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "orgNodeId" TEXT;

-- AlterTable
ALTER TABLE "SystemSettings" ADD COLUMN     "leaveApprovalLevels" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "timesheetApprovalLevels" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "OrgNode" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "parentId" TEXT,
    "headId" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrgNode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalStep" (
    "id" TEXT NOT NULL,
    "kind" "ApprovalKind" NOT NULL,
    "targetId" TEXT NOT NULL,
    "level" INTEGER NOT NULL,
    "approverId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApprovalStep_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OrgNode_parentId_idx" ON "OrgNode"("parentId");

-- CreateIndex
CREATE INDEX "ApprovalStep_kind_targetId_idx" ON "ApprovalStep"("kind", "targetId");

-- CreateIndex
CREATE UNIQUE INDEX "ApprovalStep_kind_targetId_level_key" ON "ApprovalStep"("kind", "targetId", "level");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_orgNodeId_fkey" FOREIGN KEY ("orgNodeId") REFERENCES "OrgNode"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrgNode" ADD CONSTRAINT "OrgNode_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "OrgNode"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrgNode" ADD CONSTRAINT "OrgNode_headId_fkey" FOREIGN KEY ("headId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalStep" ADD CONSTRAINT "ApprovalStep_approverId_fkey" FOREIGN KEY ("approverId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
