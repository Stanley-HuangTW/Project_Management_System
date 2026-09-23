-- 專案群組週報分發訂閱:寄給誰、寄哪些區塊、接下來幾天。
-- 排程時間是全域的,加在 SystemSettings 上。

-- AlterTable
ALTER TABLE "SystemSettings"
  ADD COLUMN "weeklyReportEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "weeklyReportDow" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "weeklyReportHour" INTEGER NOT NULL DEFAULT 6,
  ADD COLUMN "weeklyReportMinute" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "weeklyReportLastRunWeek" TEXT;

-- CreateTable
CREATE TABLE "ProgramReportSubscription" (
  "id"                 TEXT NOT NULL,
  "programId"          TEXT NOT NULL,
  "upcomingDays"       INTEGER NOT NULL DEFAULT 7,
  "includeSummary"     BOOLEAN NOT NULL DEFAULT true,
  "includeProgramDiff" BOOLEAN NOT NULL DEFAULT true,
  "includeDepartments" BOOLEAN NOT NULL DEFAULT true,
  "includeActivity"    BOOLEAN NOT NULL DEFAULT true,
  "updatedAt"          TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ProgramReportSubscription_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProgramReportSubscription_programId_key" ON "ProgramReportSubscription"("programId");

ALTER TABLE "ProgramReportSubscription"
  ADD CONSTRAINT "ProgramReportSubscription_programId_fkey"
  FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "ProgramReportRecipient" (
  "id"             TEXT NOT NULL,
  "subscriptionId" TEXT NOT NULL,
  "userId"         TEXT,
  "email"          TEXT,

  CONSTRAINT "ProgramReportRecipient_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProgramReportRecipient_subscriptionId_userId_key"
  ON "ProgramReportRecipient"("subscriptionId", "userId");

ALTER TABLE "ProgramReportRecipient"
  ADD CONSTRAINT "ProgramReportRecipient_subscriptionId_fkey"
  FOREIGN KEY ("subscriptionId") REFERENCES "ProgramReportSubscription"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProgramReportRecipient"
  ADD CONSTRAINT "ProgramReportRecipient_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable
-- 分發出去的週報拿來跟下一週比對用的快照,不是給人回看的。
CREATE TABLE "ProgramReportSnapshot" (
  "id"        TEXT NOT NULL,
  "programId" TEXT NOT NULL,
  "weekStart" TEXT NOT NULL,
  "data"      JSONB NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ProgramReportSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProgramReportSnapshot_programId_weekStart_key"
  ON "ProgramReportSnapshot"("programId", "weekStart");

ALTER TABLE "ProgramReportSnapshot"
  ADD CONSTRAINT "ProgramReportSnapshot_programId_fkey"
  FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE CASCADE ON UPDATE CASCADE;
