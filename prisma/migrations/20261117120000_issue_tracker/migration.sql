-- CreateEnum
CREATE TYPE "IssueRole" AS ENUM ('REPORTER', 'HANDLER', 'MANAGER');

-- CreateEnum
CREATE TYPE "IssueKind" AS ENUM ('REPAIR', 'ISSUE');

-- CreateEnum
CREATE TYPE "IssueStatus" AS ENUM ('OPEN', 'TC', 'PC', 'NA');

-- CreateEnum
CREATE TYPE "IssuePriority" AS ENUM ('P0', 'P1', 'P2', 'P3');

-- CreateEnum
CREATE TYPE "IssueDayMode" AS ENUM ('WORKDAY', 'CALENDAR');

-- CreateEnum
CREATE TYPE "IssueOptionKind" AS ENUM ('CUSTOMER', 'PRODUCT', 'REGION', 'CUSTOMER_TYPE', 'WARRANTY', 'ERROR_TYPE', 'PART', 'HANDLER_UNIT');

-- CreateEnum
CREATE TYPE "IssueLogKind" AS ENUM ('RESPONSE', 'ARRANGEMENT', 'SOLUTION', 'NOTE');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "issueRole" "IssueRole",
ADD COLUMN     "pmAccess" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "SystemSettings" ADD COLUMN     "issueDayMode" "IssueDayMode" NOT NULL DEFAULT 'WORKDAY',
ADD COLUMN     "issueEmailNotify" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "IssueOption" (
    "id" TEXT NOT NULL,
    "kind" "IssueOptionKind" NOT NULL,
    "name" TEXT NOT NULL,
    "shortName" TEXT,
    "defaultRegionId" TEXT,
    "customerTypeId" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IssueOption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IssueCase" (
    "id" TEXT NOT NULL,
    "caseNo" TEXT NOT NULL,
    "kind" "IssueKind" NOT NULL DEFAULT 'ISSUE',
    "priority" "IssuePriority" NOT NULL DEFAULT 'P2',
    "customerId" TEXT,
    "productId" TEXT,
    "regionId" TEXT,
    "issueDate" TEXT NOT NULL,
    "serialNo" TEXT,
    "qrCode" TEXT,
    "description" TEXT NOT NULL DEFAULT '',
    "behavior" TEXT NOT NULL DEFAULT '',
    "warrantyId" TEXT,
    "status" "IssueStatus" NOT NULL DEFAULT 'OPEN',
    "closeDate" TEXT,
    "deckCount" INTEGER,
    "cutHours" DECIMAL(10,2),
    "wheelHours" DECIMAL(10,2),
    "errorTypeId" TEXT,
    "rma" BOOLEAN NOT NULL DEFAULT false,
    "rmaCuttingDisk" BOOLEAN NOT NULL DEFAULT false,
    "repairOrderNo" TEXT,
    "reporterId" TEXT,
    "firstResponseAt" TIMESTAMP(3),
    "confirmedAt" TIMESTAMP(3),
    "confirmedById" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IssueCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IssueAssignee" (
    "caseId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "IssueAssignee_pkey" PRIMARY KEY ("caseId","userId")
);

-- CreateTable
CREATE TABLE "IssueCaseUnit" (
    "caseId" TEXT NOT NULL,
    "optionId" TEXT NOT NULL,

    CONSTRAINT "IssueCaseUnit_pkey" PRIMARY KEY ("caseId","optionId")
);

-- CreateTable
CREATE TABLE "IssueCasePart" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "partId" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "IssueCasePart_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IssueLog" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "kind" "IssueLogKind" NOT NULL,
    "content" TEXT NOT NULL,
    "internal" BOOLEAN NOT NULL DEFAULT true,
    "authorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IssueLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IssueAttachment" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "size" INTEGER NOT NULL DEFAULT 0,
    "isLink" BOOLEAN NOT NULL DEFAULT false,
    "uploaderId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IssueAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IssueCaseCounter" (
    "period" TEXT NOT NULL,
    "last" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "IssueCaseCounter_pkey" PRIMARY KEY ("period")
);

-- CreateIndex
CREATE INDEX "IssueOption_kind_order_idx" ON "IssueOption"("kind", "order");

-- CreateIndex
CREATE UNIQUE INDEX "IssueOption_kind_name_key" ON "IssueOption"("kind", "name");

-- CreateIndex
CREATE UNIQUE INDEX "IssueCase_caseNo_key" ON "IssueCase"("caseNo");

-- CreateIndex
CREATE INDEX "IssueCase_issueDate_idx" ON "IssueCase"("issueDate");

-- CreateIndex
CREATE INDEX "IssueCase_status_idx" ON "IssueCase"("status");

-- CreateIndex
CREATE INDEX "IssueCase_productId_idx" ON "IssueCase"("productId");

-- CreateIndex
CREATE INDEX "IssueCase_errorTypeId_idx" ON "IssueCase"("errorTypeId");

-- CreateIndex
CREATE INDEX "IssueCase_customerId_idx" ON "IssueCase"("customerId");

-- CreateIndex
CREATE INDEX "IssueCase_deletedAt_idx" ON "IssueCase"("deletedAt");

-- CreateIndex
CREATE INDEX "IssueAssignee_userId_idx" ON "IssueAssignee"("userId");

-- CreateIndex
CREATE INDEX "IssueCasePart_caseId_idx" ON "IssueCasePart"("caseId");

-- CreateIndex
CREATE INDEX "IssueCasePart_partId_idx" ON "IssueCasePart"("partId");

-- CreateIndex
CREATE INDEX "IssueLog_caseId_createdAt_idx" ON "IssueLog"("caseId", "createdAt");

-- CreateIndex
CREATE INDEX "IssueAttachment_caseId_idx" ON "IssueAttachment"("caseId");

-- AddForeignKey
ALTER TABLE "IssueOption" ADD CONSTRAINT "IssueOption_defaultRegionId_fkey" FOREIGN KEY ("defaultRegionId") REFERENCES "IssueOption"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssueOption" ADD CONSTRAINT "IssueOption_customerTypeId_fkey" FOREIGN KEY ("customerTypeId") REFERENCES "IssueOption"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssueCase" ADD CONSTRAINT "IssueCase_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "IssueOption"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssueCase" ADD CONSTRAINT "IssueCase_productId_fkey" FOREIGN KEY ("productId") REFERENCES "IssueOption"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssueCase" ADD CONSTRAINT "IssueCase_regionId_fkey" FOREIGN KEY ("regionId") REFERENCES "IssueOption"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssueCase" ADD CONSTRAINT "IssueCase_warrantyId_fkey" FOREIGN KEY ("warrantyId") REFERENCES "IssueOption"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssueCase" ADD CONSTRAINT "IssueCase_errorTypeId_fkey" FOREIGN KEY ("errorTypeId") REFERENCES "IssueOption"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssueCase" ADD CONSTRAINT "IssueCase_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssueCase" ADD CONSTRAINT "IssueCase_confirmedById_fkey" FOREIGN KEY ("confirmedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssueAssignee" ADD CONSTRAINT "IssueAssignee_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "IssueCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssueAssignee" ADD CONSTRAINT "IssueAssignee_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssueCaseUnit" ADD CONSTRAINT "IssueCaseUnit_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "IssueCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssueCaseUnit" ADD CONSTRAINT "IssueCaseUnit_optionId_fkey" FOREIGN KEY ("optionId") REFERENCES "IssueOption"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssueCasePart" ADD CONSTRAINT "IssueCasePart_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "IssueCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssueCasePart" ADD CONSTRAINT "IssueCasePart_partId_fkey" FOREIGN KEY ("partId") REFERENCES "IssueOption"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssueLog" ADD CONSTRAINT "IssueLog_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "IssueCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssueLog" ADD CONSTRAINT "IssueLog_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssueAttachment" ADD CONSTRAINT "IssueAttachment_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "IssueCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssueAttachment" ADD CONSTRAINT "IssueAttachment_uploaderId_fkey" FOREIGN KEY ("uploaderId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

