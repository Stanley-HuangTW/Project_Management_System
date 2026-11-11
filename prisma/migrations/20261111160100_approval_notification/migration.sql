-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "link" TEXT;

ALTER TABLE "SystemSettings" ALTER COLUMN "enabledNotificationTypes" SET DEFAULT ARRAY['ASSIGNED', 'UPDATED', 'COMMENTED', 'AUTOMATION', 'CREATED', 'DELETED', 'DEADLINE', 'CHAT', 'APPROVAL']::"NotificationType"[];

-- 已經存在的設定:管理者之前沒有關掉的類型一律照舊,新的「簽核」類型也要開著,不然誰都收不到。
UPDATE "SystemSettings" SET "enabledNotificationTypes" = array_append("enabledNotificationTypes", 'APPROVAL'::"NotificationType")
WHERE NOT ('APPROVAL'::"NotificationType" = ANY("enabledNotificationTypes"));
