-- CreateTable
CREATE TABLE "ProtoUnit" (
    "id" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "product" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "phaseId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProtoUnit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ItemProtoUnit" (
    "itemId" TEXT NOT NULL,
    "protoUnitId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ItemProtoUnit_pkey" PRIMARY KEY ("itemId","protoUnitId")
);

-- CreateIndex
CREATE INDEX "ProtoUnit_boardId_idx" ON "ProtoUnit"("boardId");

-- CreateIndex
CREATE UNIQUE INDEX "ProtoUnit_boardId_product_unit_phaseId_seq_key" ON "ProtoUnit"("boardId", "product", "unit", "phaseId", "seq");

-- CreateIndex
CREATE INDEX "ItemProtoUnit_protoUnitId_idx" ON "ItemProtoUnit"("protoUnitId");

-- AddForeignKey
ALTER TABLE "ProtoUnit" ADD CONSTRAINT "ProtoUnit_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "Board"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProtoUnit" ADD CONSTRAINT "ProtoUnit_phaseId_fkey" FOREIGN KEY ("phaseId") REFERENCES "BudgetPhase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemProtoUnit" ADD CONSTRAINT "ItemProtoUnit_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemProtoUnit" ADD CONSTRAINT "ItemProtoUnit_protoUnitId_fkey" FOREIGN KEY ("protoUnitId") REFERENCES "ProtoUnit"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- 補資料:現有樣機計畫的每一格(qty = N)各產生 N 台樣機(第 1 ~ N 台)。
INSERT INTO "ProtoUnit" ("id", "boardId", "product", "unit", "phaseId", "seq")
SELECT gen_random_uuid()::text, p."boardId", p."product", p."unit", p."phaseId", s
FROM "ProtoPlan" p
CROSS JOIN LATERAL generate_series(1, p."qty") AS s
WHERE p."qty" > 0;
