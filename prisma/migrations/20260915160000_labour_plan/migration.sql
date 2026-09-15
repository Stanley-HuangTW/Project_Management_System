-- 人力成本本來只有一個入口:每個人一個時薪。實際上編預算的時候還不知道會
-- 是誰做,談的是「EE 幾個人月、ME 幾個人月」,所以這裡補上三件事:單位、
-- 月薪(單位標準價與個人覆寫),以及階段 × 單位的人月規劃表。
CREATE TYPE "Discipline" AS ENUM ('EE', 'SW', 'QA', 'ME', 'PM', 'OTHER');

ALTER TABLE "User" ADD COLUMN     "discipline" "Discipline";
ALTER TABLE "User" ADD COLUMN     "monthlySalary" DECIMAL(12,2);

-- 把月薪換成時薪、把人月換成工時的係數。既有的每人時薪仍然優先,所以
-- 現有的每一筆成本數字都不會因為這次而改變。
ALTER TABLE "SystemSettings" ADD COLUMN     "workingDaysPerMonth" INTEGER NOT NULL DEFAULT 21;

CREATE TABLE "DisciplineRate" (
    "discipline" "Discipline" NOT NULL,
    "monthlySalary" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DisciplineRate_pkey" PRIMARY KEY ("discipline")
);

CREATE TABLE "LabourPlan" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "discipline" "Discipline" NOT NULL,
    "personMonths" DECIMAL(8,2) NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LabourPlan_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LabourPlan_itemId_discipline_key" ON "LabourPlan"("itemId", "discipline");

ALTER TABLE "LabourPlan" ADD CONSTRAINT "LabourPlan_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;
