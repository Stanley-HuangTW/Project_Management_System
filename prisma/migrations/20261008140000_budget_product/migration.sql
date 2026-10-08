-- 看板的產品清單:產品可以單獨存在(先新增產品、再填 BOM),也可以整個刪掉。
CREATE TABLE "BudgetProduct" (
    "id" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BudgetProduct_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BudgetProduct_boardId_name_key" ON "BudgetProduct"("boardId", "name");

ALTER TABLE "BudgetProduct" ADD CONSTRAINT "BudgetProduct_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "Board"("id") ON DELETE CASCADE ON UPDATE CASCADE;
