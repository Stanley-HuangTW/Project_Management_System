-- AlterTable
ALTER TABLE "ActivityLogEntry" ADD COLUMN     "eventKind" TEXT,
ADD COLUMN     "statusKind" TEXT,
ADD COLUMN     "statusLabel" TEXT;

-- CreateIndex
CREATE INDEX "ActivityLogEntry_boardId_eventKind_createdAt_idx" ON "ActivityLogEntry"("boardId", "eventKind", "createdAt");

-- 舊的工作項紀錄只有一句中文。把能認得出來的補上種類(給「更新記錄」欄、本週完成、週報用);
-- 狀態切換另外補上「切到哪個選項」與它算進行中還是完成。認不出來的留空,畫面當作沒有紀錄。
UPDATE "ActivityLogEntry" SET "eventKind" = 'UPDATE'
  WHERE "category" = 'ITEM' AND "itemId" IS NOT NULL AND "message" = '新增留言';

UPDATE "ActivityLogEntry" SET "eventKind" = 'LINK'
  WHERE "category" = 'ITEM' AND "itemId" IS NOT NULL
    AND ("message" LIKE '新增連結「%' OR "message" LIKE '刪除連結「%');

UPDATE "ActivityLogEntry" SET "eventKind" = 'TODO'
  WHERE "category" = 'ITEM' AND "itemId" IS NOT NULL
    AND ("message" LIKE '新增待辦事項:「%' OR "message" LIKE '完成待辦事項:「%' OR "message" LIKE '取消完成待辦事項:「%');

-- 狀態切換:狀態欄叫 Status 的看板(畫面上的「狀態」就是它),訊息是「「Status」已更新:舊 → 新」。
UPDATE "ActivityLogEntry" SET
    "eventKind" = 'STATUS',
    "statusLabel" = split_part("message", ' → ', 2),
    "statusKind" = CASE
      WHEN split_part("message", ' → ', 2) ~* '^(completed?|done|完成|已完成|已結案)$' THEN 'done'
      WHEN split_part("message", ' → ', 2) ~* '(in[ _-]?progress|進行中|實作中|處理中|doing|working)' THEN 'inProgress'
      ELSE 'other'
    END
  WHERE "category" = 'ITEM' AND "itemId" IS NOT NULL AND "message" LIKE '「Status」已更新:% → %';

-- 其餘的工作項異動(改日期、進度、指派、改名、上傳檔案……)都算「其他欄位」。
UPDATE "ActivityLogEntry" SET "eventKind" = 'FIELD'
  WHERE "category" = 'ITEM' AND "itemId" IS NOT NULL AND "eventKind" IS NULL;
