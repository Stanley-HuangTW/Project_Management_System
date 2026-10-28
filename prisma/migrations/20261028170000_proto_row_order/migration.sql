-- CreateTable
CREATE TABLE "ProtoRowOrder" (
    "id" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "product" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "order" INTEGER NOT NULL,

    CONSTRAINT "ProtoRowOrder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProtoRowOrder_boardId_product_unit_key" ON "ProtoRowOrder"("boardId", "product", "unit");

-- AddForeignKey
ALTER TABLE "ProtoRowOrder" ADD CONSTRAINT "ProtoRowOrder_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "Board"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 階段的順序一律照時間:各預算表(樣機計畫、階段預算、NRE、BOM)共用 BudgetPhase.order,
-- 以前新增的階段一律排在最後(例如在人力表補的 EVT2 排在 PVT 後面),這裡一次依開始日重排。
UPDATE "BudgetPhase" AS p
SET "order" = r.rn - 1
FROM (
    SELECT id, ROW_NUMBER() OVER (PARTITION BY "boardId" ORDER BY "startDate", "endDate", "order", "createdAt") AS rn
    FROM "BudgetPhase"
) AS r
WHERE p.id = r.id;
