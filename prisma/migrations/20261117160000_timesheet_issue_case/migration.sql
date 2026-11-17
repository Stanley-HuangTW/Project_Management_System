-- AlterTable
ALTER TABLE "ActivityTimeEntry" ADD COLUMN     "issueCaseId" TEXT;

-- AlterTable
ALTER TABLE "TimeCategory" ADD COLUMN     "linkIssueCase" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "ActivityTimeEntry_issueCaseId_idx" ON "ActivityTimeEntry"("issueCaseId");

-- AddForeignKey
ALTER TABLE "ActivityTimeEntry" ADD CONSTRAINT "ActivityTimeEntry_issueCaseId_fkey" FOREIGN KEY ("issueCaseId") REFERENCES "IssueCase"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 預設的工時類別「案件處理」:ISSUE TRACKER 處理案件登記的工時用。已經有同名的類別就只是開啟連結案件。
INSERT INTO "TimeCategory" ("id", "name", "order", "active", "linkIssue", "allowProject", "linkIssueCase")
SELECT 'cat_issue_case', '案件處理', COALESCE(MAX("order"), -1) + 1, true, false, false, true FROM "TimeCategory"
ON CONFLICT ("name") DO UPDATE SET "linkIssueCase" = true;
