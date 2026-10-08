-- 預算類別多一個「驗證與認證」。
ALTER TYPE "CostCategory" ADD VALUE 'CERTIFICATION';

-- NRE 報價單:四大項與逐列明細(掛在預算階段上)。
CREATE TYPE "NreCategory" AS ENUM ('LABOUR', 'TOOLING', 'PROTOTYPE', 'CERTIFICATION');

CREATE TABLE "NreLine" (
    "id" TEXT NOT NULL,
    "phaseId" TEXT NOT NULL,
    "category" "NreCategory" NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "description" TEXT NOT NULL,
    "basis" TEXT,
    "vendor" TEXT,
    "quantity" DOUBLE PRECISION,
    "unitPrice" INTEGER,
    "amount" INTEGER NOT NULL,
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NreLine_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "NreLine_phaseId_category_order_idx" ON "NreLine"("phaseId", "category", "order");

ALTER TABLE "NreLine" ADD CONSTRAINT "NreLine_phaseId_fkey" FOREIGN KEY ("phaseId") REFERENCES "BudgetPhase"("id") ON DELETE CASCADE ON UPDATE CASCADE;
