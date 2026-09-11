-- CreateTable
-- 專案群組:一組一起交付的看板,共用一張排程網路。
CREATE TABLE "Program" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Program_pkey" PRIMARY KEY ("id")
);

-- AlterTable
-- 既有看板一律不屬於任何群組:升級後行為完全不變,每個看板仍自成一個專案。
ALTER TABLE "Board" ADD COLUMN     "programId" TEXT;

-- CreateIndex
CREATE INDEX "Board_programId_idx" ON "Board"("programId");

-- AddForeignKey
ALTER TABLE "Board" ADD CONSTRAINT "Board_programId_fkey" FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE SET NULL ON UPDATE CASCADE;
