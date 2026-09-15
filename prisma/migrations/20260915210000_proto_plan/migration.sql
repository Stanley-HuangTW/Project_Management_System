-- 樣機使用計畫:產品 × 用途單位 × 階段 = 幾台。人力表回答「要幾個人月」,
-- 這張回答「要備幾台樣機」,兩者共用同一組預算階段,所以月份與階段對得起來。
CREATE TABLE "ProtoPlan" (
    "id" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "product" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "phaseId" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProtoPlan_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ProtoPlan_boardId_product_unit_phaseId_key" ON "ProtoPlan"("boardId", "product", "unit", "phaseId");
CREATE INDEX "ProtoPlan_boardId_product_idx" ON "ProtoPlan"("boardId", "product");
ALTER TABLE "ProtoPlan" ADD CONSTRAINT "ProtoPlan_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "Board"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProtoPlan" ADD CONSTRAINT "ProtoPlan_phaseId_fkey" FOREIGN KEY ("phaseId") REFERENCES "BudgetPhase"("id") ON DELETE CASCADE ON UPDATE CASCADE;
