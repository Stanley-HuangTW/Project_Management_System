-- 通知本來只涵蓋「指派/更新/留言/自動化」,一列被新增或刪除是沒有通知的 ——
-- 而那正是最該讓同一個分組的人知道的兩件事。
ALTER TYPE "NotificationType" ADD VALUE 'CREATED';
ALTER TYPE "NotificationType" ADD VALUE 'DELETED';
