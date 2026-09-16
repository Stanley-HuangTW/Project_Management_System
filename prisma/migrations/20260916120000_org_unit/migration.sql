-- 工程單位從列舉改成資料表。公司會新增單位(FAE、NPI、Sourcing……),
-- 那是設定,不該每次都要改 schema 再上一次版。

CREATE TABLE "OrgUnit" (
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "OrgUnit_pkey" PRIMARY KEY ("code")
);

CREATE INDEX "OrgUnit_order_idx" ON "OrgUnit"("order");

-- 預設六個單位。
INSERT INTO "OrgUnit" ("code", "label", "order") VALUES
    ('EE',  'EE 電機',     0),
    ('ME',  'ME 機構',     1),
    ('SW',  'SW 軟體',     2),
    ('QA',  'QA 品保',     3),
    ('FAE', 'FAE 技術支援', 4),
    ('PM',  'PM 專案',     5)
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "OrgUnit" ("code", "label", "order") VALUES ('OTHER', '其他', 90)
ON CONFLICT ("code") DO NOTHING;

-- 舊資料裡用到的每一個值都要先有一列,否則下面的外鍵建不起來。
INSERT INTO "OrgUnit" ("code", "label", "order")
SELECT DISTINCT d::text, d::text, 91
FROM (
    SELECT "discipline" AS d FROM "User" WHERE "discipline" IS NOT NULL
    UNION SELECT "discipline" FROM "DisciplineRate"
    UNION SELECT "discipline" FROM "LabourPlan"
    UNION SELECT "discipline" FROM "LabourSlot"
) AS used
ON CONFLICT ("code") DO NOTHING;

ALTER TABLE "User"           ALTER COLUMN "discipline" TYPE TEXT USING "discipline"::text;
ALTER TABLE "DisciplineRate" ALTER COLUMN "discipline" TYPE TEXT USING "discipline"::text;
ALTER TABLE "LabourPlan"     ALTER COLUMN "discipline" TYPE TEXT USING "discipline"::text;
ALTER TABLE "LabourSlot"     ALTER COLUMN "discipline" TYPE TEXT USING "discipline"::text;

DROP TYPE "Discipline";

-- 人身上的單位刪掉就清空;有金額、有人月的三張表擋住,不給連數字一起刪掉。
ALTER TABLE "User" ADD CONSTRAINT "User_discipline_fkey"
    FOREIGN KEY ("discipline") REFERENCES "OrgUnit"("code") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "DisciplineRate" ADD CONSTRAINT "DisciplineRate_discipline_fkey"
    FOREIGN KEY ("discipline") REFERENCES "OrgUnit"("code") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LabourPlan" ADD CONSTRAINT "LabourPlan_discipline_fkey"
    FOREIGN KEY ("discipline") REFERENCES "OrgUnit"("code") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LabourSlot" ADD CONSTRAINT "LabourSlot_discipline_fkey"
    FOREIGN KEY ("discipline") REFERENCES "OrgUnit"("code") ON DELETE RESTRICT ON UPDATE CASCADE;
