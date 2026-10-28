-- AlterTable
ALTER TABLE "TodoItem" ADD COLUMN     "assigneeId" TEXT;

-- CreateTable
CREATE TABLE "RiskTodo" (
    "id" TEXT NOT NULL,
    "riskId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "done" BOOLEAN NOT NULL DEFAULT false,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueDate" TEXT,
    "remindedStage" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "assigneeId" TEXT,

    CONSTRAINT "RiskTodo_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RiskTodo_riskId_idx" ON "RiskTodo"("riskId");

-- CreateIndex
CREATE INDEX "RiskTodo_dueDate_idx" ON "RiskTodo"("dueDate");

-- CreateIndex
CREATE INDEX "RiskTodo_assigneeId_idx" ON "RiskTodo"("assigneeId");

-- CreateIndex
CREATE INDEX "TodoItem_assigneeId_idx" ON "TodoItem"("assigneeId");

-- AddForeignKey
ALTER TABLE "RiskTodo" ADD CONSTRAINT "RiskTodo_riskId_fkey" FOREIGN KEY ("riskId") REFERENCES "RiskEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

