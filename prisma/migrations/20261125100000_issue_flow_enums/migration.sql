-- 新的列舉值要單獨一個 migration:同一個交易裡不能馬上用剛加的值。
ALTER TYPE "NotificationType" ADD VALUE 'ISSUE_FLOW';
ALTER TYPE "IssueLogKind" ADD VALUE 'STAGE';
