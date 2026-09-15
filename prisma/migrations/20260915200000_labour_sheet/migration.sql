-- 人力堆疊表。上一版的 LabourPlan(階段 × 單位人月)是結果,這裡是推算過程:
-- 一列是一個人力名額,每個月填 FTE,加總才得到人月。
--
-- 預算表有自己的一組階段起訖日,刻意不沿用看板算出來的 —— 預算表是初期
-- 評估,跟實際時程一定有落差,而那個落差是要拿來看的,不是要消滅的。

CREATE TABLE "BudgetPhase" (
    "id" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "startDate" TEXT NOT NULL,
    "endDate" TEXT NOT NULL,
    "itemId" TEXT,
    "order" INTEGER NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BudgetPhase_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "BudgetPhase_boardId_order_idx" ON "BudgetPhase"("boardId", "order");
ALTER TABLE "BudgetPhase" ADD CONSTRAINT "BudgetPhase_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "Board"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "PlanMilestone" (
    "id" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "track" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "startDate" TEXT NOT NULL,
    "endDate" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#fdab3d',
    "order" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlanMilestone_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "PlanMilestone_boardId_track_order_idx" ON "PlanMilestone"("boardId", "track", "order");
ALTER TABLE "PlanMilestone" ADD CONSTRAINT "PlanMilestone_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "Board"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "LabourSlot" (
    "id" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "discipline" "Discipline" NOT NULL,
    "label" TEXT NOT NULL,
    "func" TEXT NOT NULL DEFAULT '',
    "userId" TEXT,
    "ownerLabel" TEXT NOT NULL DEFAULT '',
    "description" TEXT NOT NULL DEFAULT '',
    "order" INTEGER NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LabourSlot_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "LabourSlot_boardId_order_idx" ON "LabourSlot"("boardId", "order");
ALTER TABLE "LabourSlot" ADD CONSTRAINT "LabourSlot_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "Board"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LabourSlot" ADD CONSTRAINT "LabourSlot_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "LabourSlotMonth" (
    "id" TEXT NOT NULL,
    "slotId" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "fte" DECIMAL(5,2) NOT NULL,

    CONSTRAINT "LabourSlotMonth_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "LabourSlotMonth_slotId_month_key" ON "LabourSlotMonth"("slotId", "month");
ALTER TABLE "LabourSlotMonth" ADD CONSTRAINT "LabourSlotMonth_slotId_fkey" FOREIGN KEY ("slotId") REFERENCES "LabourSlot"("id") ON DELETE CASCADE ON UPDATE CASCADE;
