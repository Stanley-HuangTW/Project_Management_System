-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "riskId" TEXT,
ALTER COLUMN "itemId" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "Notification_riskId_idx" ON "Notification"("riskId");

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_riskId_fkey" FOREIGN KEY ("riskId") REFERENCES "RiskEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;
