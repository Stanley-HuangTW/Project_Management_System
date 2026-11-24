-- AlterTable
ALTER TABLE "IssueCase" ADD COLUMN     "mantisId" INTEGER,
ADD COLUMN     "mantisUpdatedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "IssueMantisConnection" (
    "id" TEXT NOT NULL DEFAULT 'global',
    "baseUrl" TEXT NOT NULL,
    "projectId" INTEGER NOT NULL,
    "projectName" TEXT NOT NULL,
    "tokenEnc" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastSyncAt" TIMESTAMP(3),
    "lastSyncError" TEXT,
    "lastSyncSummary" JSONB,
    "mapping" JSONB,
    "users" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IssueMantisConnection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "IssueCase_mantisId_key" ON "IssueCase"("mantisId");

