-- 通知類型偏好:系統層級(SystemSettings.enabledNotificationTypes,管理者可以整個
-- 關掉某一種類型)與個人層級(NotificationPreference,站內/email 各自開關)。

-- AlterTable
ALTER TABLE "SystemSettings"
  ADD COLUMN "enabledNotificationTypes" "NotificationType"[] NOT NULL
  DEFAULT ARRAY['ASSIGNED','UPDATED','COMMENTED','AUTOMATION','CREATED','DELETED']::"NotificationType"[];

-- CreateTable
CREATE TABLE "NotificationPreference" (
  "id"        TEXT NOT NULL,
  "userId"    TEXT NOT NULL,
  "type"      "NotificationType" NOT NULL,
  "inApp"     BOOLEAN NOT NULL DEFAULT true,
  "email"     BOOLEAN NOT NULL DEFAULT false,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "NotificationPreference_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "NotificationPreference_userId_type_key"
  ON "NotificationPreference"("userId", "type");

ALTER TABLE "NotificationPreference"
  ADD CONSTRAINT "NotificationPreference_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
