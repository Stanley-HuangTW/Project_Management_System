-- AlterTable
ALTER TABLE "SystemSettings" ADD COLUMN     "budgetViewOrgNodeIds" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "BoardBudgetViewer" (
    "id" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BoardBudgetViewer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BoardBudgetViewer_userId_idx" ON "BoardBudgetViewer"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "BoardBudgetViewer_boardId_userId_key" ON "BoardBudgetViewer"("boardId", "userId");

-- AddForeignKey
ALTER TABLE "BoardBudgetViewer" ADD CONSTRAINT "BoardBudgetViewer_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "Board"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoardBudgetViewer" ADD CONSTRAINT "BoardBudgetViewer_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
