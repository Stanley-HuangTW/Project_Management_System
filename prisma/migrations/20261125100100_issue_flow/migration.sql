-- CreateEnum
CREATE TYPE "IssueLane" AS ENUM ('SALES', 'FAE', 'RD');

-- CreateEnum
CREATE TYPE "IssueStage" AS ENUM ('REPORTED', 'FAE_REVIEW', 'RD_WORKING', 'SALES_DECISION', 'IN_TRANSIT', 'RECEIVED', 'REPAIRING', 'REPAIRED', 'CLOSING', 'CLOSED');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "issueLanes" "IssueLane"[] DEFAULT ARRAY[]::"IssueLane"[];

-- AlterTable
ALTER TABLE "SystemSettings" ADD COLUMN     "issueFlowEmail" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "issueStuckDays" INTEGER NOT NULL DEFAULT 3,
ALTER COLUMN "enabledNotificationTypes" SET DEFAULT ARRAY['ASSIGNED', 'UPDATED', 'COMMENTED', 'AUTOMATION', 'CREATED', 'DELETED', 'DEADLINE', 'CHAT', 'APPROVAL', 'ISSUE_FLOW']::"NotificationType"[];

-- AlterTable
ALTER TABLE "IssueCase" ADD COLUMN     "stage" "IssueStage" NOT NULL DEFAULT 'REPORTED',
ADD COLUMN     "stageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "stuckNotifiedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "IssueRegionFae" (
    "regionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "IssueRegionFae_pkey" PRIMARY KEY ("regionId","userId")
);

-- CreateIndex
CREATE INDEX "IssueRegionFae_userId_idx" ON "IssueRegionFae"("userId");

-- CreateIndex
CREATE INDEX "IssueCase_stage_idx" ON "IssueCase"("stage");

-- AddForeignKey
ALTER TABLE "IssueRegionFae" ADD CONSTRAINT "IssueRegionFae_regionId_fkey" FOREIGN KEY ("regionId") REFERENCES "IssueOption"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssueRegionFae" ADD CONSTRAINT "IssueRegionFae_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 舊案件的階段:依狀態推。已確認完成(鎖定)或不適用 → 已結案;已是暫時 / 永久解決但還沒確認 → 待 Sales 判斷(問題)/ 維修完成(維修);處理中 → FAE 評估(問題)/ 維修中(維修)。
UPDATE "IssueCase" SET "stage" = CASE
  WHEN "confirmedAt" IS NOT NULL OR "status" = 'NA' THEN 'CLOSED'::"IssueStage"
  WHEN "status" IN ('TC', 'PC') AND "kind" = 'REPAIR' THEN 'REPAIRED'::"IssueStage"
  WHEN "status" IN ('TC', 'PC') THEN 'SALES_DECISION'::"IssueStage"
  WHEN "kind" = 'REPAIR' THEN 'REPAIRING'::"IssueStage"
  ELSE 'FAE_REVIEW'::"IssueStage"
END;

-- 流程通知類型預設開啟(管理者可以在系統設定關掉)。
UPDATE "SystemSettings" SET "enabledNotificationTypes" = array_append("enabledNotificationTypes", 'ISSUE_FLOW'::"NotificationType")
WHERE NOT ('ISSUE_FLOW'::"NotificationType" = ANY("enabledNotificationTypes"));
