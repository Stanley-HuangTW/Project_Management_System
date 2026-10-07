-- 與 MantisBT 單向同步:看板與 Mantis 專案的連線,以及風險/議題上的 Mantis 來源資訊。

-- AlterTable
ALTER TABLE "RiskEntry"
  ADD COLUMN "mantisId" INTEGER,
  ADD COLUMN "mantisUrl" TEXT,
  ADD COLUMN "mantisStatus" TEXT,
  ADD COLUMN "mantisHandler" TEXT,
  ADD COLUMN "mantisUpdatedAt" TIMESTAMP(3);

-- CreateIndex(NULL 不算重複,手動建立的風險/議題不受影響)
CREATE UNIQUE INDEX "RiskEntry_boardId_mantisId_key" ON "RiskEntry"("boardId", "mantisId");

-- CreateTable
CREATE TABLE "MantisConnection" (
    "id" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "baseUrl" TEXT NOT NULL,
    "projectId" INTEGER NOT NULL,
    "projectName" TEXT NOT NULL,
    "tokenEnc" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "issueItemId" TEXT,
    "lastSyncAt" TIMESTAMP(3),
    "lastSyncError" TEXT,
    "lastSyncSummary" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MantisConnection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MantisConnection_boardId_key" ON "MantisConnection"("boardId");

-- AddForeignKey
ALTER TABLE "MantisConnection" ADD CONSTRAINT "MantisConnection_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "Board"("id") ON DELETE CASCADE ON UPDATE CASCADE;
