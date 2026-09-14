-- 準備金:應變(已知風險)與管理(未知)。跟核准預算同一層,階段各自一筆。
CREATE TYPE "ReserveKind" AS ENUM ('CONTINGENCY', 'MANAGEMENT');

CREATE TABLE "Reserve" (
    "id" TEXT NOT NULL,
    "itemId" TEXT,
    "programId" TEXT,
    "kind" "ReserveKind" NOT NULL,
    "amount" INTEGER NOT NULL,
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Reserve_pkey" PRIMARY KEY ("id")
);

-- 動支:把準備金撥進某個類別。撥款同時會把該類別的核准預算加上同額,
-- 所以總額不變 —— 這張表記的是那次搬動的理由與經手人。
CREATE TABLE "ReserveDraw" (
    "id" TEXT NOT NULL,
    "reserveId" TEXT NOT NULL,
    "category" "CostCategory" NOT NULL,
    "amount" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "decidedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReserveDraw_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Reserve_itemId_kind_key" ON "Reserve"("itemId", "kind");
CREATE UNIQUE INDEX "Reserve_programId_kind_key" ON "Reserve"("programId", "kind");
CREATE INDEX "ReserveDraw_reserveId_idx" ON "ReserveDraw"("reserveId");

ALTER TABLE "Reserve" ADD CONSTRAINT "Reserve_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Reserve" ADD CONSTRAINT "Reserve_programId_fkey" FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReserveDraw" ADD CONSTRAINT "ReserveDraw_reserveId_fkey" FOREIGN KEY ("reserveId") REFERENCES "Reserve"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ReserveDraw" ADD CONSTRAINT "ReserveDraw_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
