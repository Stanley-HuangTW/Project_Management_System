-- CreateTable
-- 每次建立基準線都留一份,不再覆蓋前一版。
CREATE TABLE "Baseline" (
    "id" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "capturedById" TEXT,
    "itemCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Baseline_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BaselineEntry" (
    "id" TEXT NOT NULL,
    "baselineId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "start" TEXT,
    "end" TEXT,
    "days" INTEGER,

    CONSTRAINT "BaselineEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Baseline_boardId_capturedAt_idx" ON "Baseline"("boardId", "capturedAt");
CREATE UNIQUE INDEX "BaselineEntry_baselineId_itemId_key" ON "BaselineEntry"("baselineId", "itemId");

-- AddForeignKey
ALTER TABLE "Baseline" ADD CONSTRAINT "Baseline_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "Board"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BaselineEntry" ADD CONSTRAINT "BaselineEntry_baselineId_fkey" FOREIGN KEY ("baselineId") REFERENCES "Baseline"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The baseline a board already holds becomes its first archived version, so
-- nobody loses the plan they captured before this existed.
INSERT INTO "Baseline" ("id", "boardId", "name", "capturedAt", "itemCount")
SELECT
    'bl_' || substr(md5(random()::text || b."id"), 1, 20),
    b."id",
    to_char(b."baselineCapturedAt", 'YYYY-MM-DD HH24:MI') || ' (匯入)',
    b."baselineCapturedAt",
    (SELECT count(*) FROM "Item" i WHERE i."boardId" = b."id" AND i."baselineStart" IS NOT NULL)
FROM "Board" b
WHERE b."baselineCapturedAt" IS NOT NULL;

INSERT INTO "BaselineEntry" ("id", "baselineId", "itemId", "start", "end", "days")
SELECT
    'be_' || substr(md5(random()::text || i."id"), 1, 20),
    bl."id",
    i."id",
    i."baselineStart",
    i."baselineEnd",
    i."baselineDays"
FROM "Item" i
JOIN "Baseline" bl ON bl."boardId" = i."boardId"
WHERE i."baselineStart" IS NOT NULL;
