-- 預算編輯權要認「專案建立者」,而專案群組原本沒有記是誰建的。
-- 既有的群組留 null:它們只有管理者能編預算,直到有人重建或管理者代為設定。
ALTER TABLE "Program" ADD COLUMN "createdById" TEXT;
