-- 里程碑的「排在哪一列」本來是使用者隨手打的一段字。改成一張看得見、
-- 管得動的類型表:同一個類型排同一排,類型本身可以新增、改名、刪除。

CREATE TABLE "MilestoneType" (
    "id" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MilestoneType_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MilestoneType_boardId_name_key" ON "MilestoneType"("boardId", "name");
CREATE INDEX "MilestoneType_boardId_order_idx" ON "MilestoneType"("boardId", "order");

ALTER TABLE "MilestoneType" ADD CONSTRAINT "MilestoneType_boardId_fkey"
    FOREIGN KEY ("boardId") REFERENCES "Board"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 既有的每一個 track 變成一個類型,排序照它第一次出現的順序。
INSERT INTO "MilestoneType" ("id", "boardId", "name", "order", "updatedAt")
SELECT
    md5("boardId" || ':' || "track"),
    "boardId",
    "track",
    row_number() OVER (PARTITION BY "boardId" ORDER BY min("order"), "track") - 1,
    CURRENT_TIMESTAMP
FROM "PlanMilestone"
GROUP BY "boardId", "track";

ALTER TABLE "PlanMilestone" ADD COLUMN "typeId" TEXT;

UPDATE "PlanMilestone" m
SET "typeId" = t."id"
FROM "MilestoneType" t
WHERE t."boardId" = m."boardId" AND t."name" = m."track";

-- 每一列都對到了才收緊,不然下面的 NOT NULL 會失敗。
ALTER TABLE "PlanMilestone" ALTER COLUMN "typeId" SET NOT NULL;

ALTER TABLE "PlanMilestone" ADD CONSTRAINT "PlanMilestone_typeId_fkey"
    FOREIGN KEY ("typeId") REFERENCES "MilestoneType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

DROP INDEX "PlanMilestone_boardId_track_order_idx";
ALTER TABLE "PlanMilestone" DROP COLUMN "track";
CREATE INDEX "PlanMilestone_boardId_typeId_order_idx" ON "PlanMilestone"("boardId", "typeId", "order");
