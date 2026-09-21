-- 樣機 BOM:產品 × 階段一份,可以往下分子集。

CREATE TABLE "BomLine" (
  "id"          TEXT NOT NULL,
  "boardId"     TEXT NOT NULL,
  "product"     TEXT NOT NULL,
  "phaseId"     TEXT NOT NULL,
  "parentId"    TEXT,
  "name"        TEXT NOT NULL,
  "vendor"      TEXT NOT NULL DEFAULT '',
  "partNumber"  TEXT NOT NULL DEFAULT '',
  "qty"         DECIMAL(12,3) NOT NULL,
  "unitPrice"   DECIMAL(14,4) NOT NULL,
  "currency"    TEXT NOT NULL DEFAULT 'TWD',
  "fxRate"      DECIMAL(12,6) NOT NULL,
  "note"        TEXT NOT NULL DEFAULT '',
  "order"       INTEGER NOT NULL,
  "createdById" TEXT,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL,

  CONSTRAINT "BomLine_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "BomLine_boardId_product_phaseId_order_idx"
  ON "BomLine"("boardId", "product", "phaseId", "order");
CREATE INDEX "BomLine_parentId_idx" ON "BomLine"("parentId");

ALTER TABLE "BomLine"
  ADD CONSTRAINT "BomLine_boardId_fkey"
  FOREIGN KEY ("boardId") REFERENCES "Board"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "BomLine"
  ADD CONSTRAINT "BomLine_phaseId_fkey"
  FOREIGN KEY ("phaseId") REFERENCES "BudgetPhase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 刪掉一個子集,底下的零件跟著走 —— 留著的話它們會變成沒有上層的孤兒,
-- 在樹上看不見卻還算進單台價格裡。
ALTER TABLE "BomLine"
  ADD CONSTRAINT "BomLine_parentId_fkey"
  FOREIGN KEY ("parentId") REFERENCES "BomLine"("id") ON DELETE CASCADE ON UPDATE CASCADE;
