-- 專案預算管控:核准預算(階段層 + 專案群組層)、已下單未入帳、實際支出明細。
CREATE TYPE "CostCategory" AS ENUM ('LABOUR', 'MATERIAL', 'TOOLING', 'OUTSOURCING', 'TRAVEL', 'OTHER');

CREATE TABLE "Budget" (
    "id" TEXT NOT NULL,
    "groupId" TEXT,
    "programId" TEXT,
    "category" "CostCategory" NOT NULL,
    "amount" INTEGER NOT NULL,
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Budget_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Commitment" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "category" "CostCategory" NOT NULL,
    "amount" INTEGER NOT NULL,
    "vendor" TEXT,
    "poNumber" TEXT,
    "expectedDate" TEXT,
    "settled" BOOLEAN NOT NULL DEFAULT false,
    "settledAt" TIMESTAMP(3),
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Commitment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Expense" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "itemId" TEXT,
    "category" "CostCategory" NOT NULL,
    "amount" INTEGER NOT NULL,
    "date" TEXT NOT NULL,
    "vendor" TEXT,
    "note" TEXT,
    "commitmentId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Expense_pkey" PRIMARY KEY ("id")
);

-- 同一個階段(或同一個群組)的同一個類別只能有一筆核准預算。Postgres 把 NULL
-- 視為互不相同,所以掛在另一層的那些列不會互相擋到。
CREATE UNIQUE INDEX "Budget_groupId_category_key" ON "Budget"("groupId", "category");
CREATE UNIQUE INDEX "Budget_programId_category_key" ON "Budget"("programId", "category");
CREATE INDEX "Commitment_groupId_settled_idx" ON "Commitment"("groupId", "settled");
CREATE INDEX "Expense_groupId_date_idx" ON "Expense"("groupId", "date");

ALTER TABLE "Budget" ADD CONSTRAINT "Budget_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Budget" ADD CONSTRAINT "Budget_programId_fkey" FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Commitment" ADD CONSTRAINT "Commitment_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;
