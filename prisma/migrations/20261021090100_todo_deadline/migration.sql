-- AlterTable
ALTER TABLE "TodoItem" ADD COLUMN     "createdById" TEXT,
ADD COLUMN     "dueDate" TEXT,
ADD COLUMN     "remindedStage" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "SystemSettings" ALTER COLUMN "enabledNotificationTypes" SET DEFAULT ARRAY['ASSIGNED', 'UPDATED', 'COMMENTED', 'AUTOMATION', 'CREATED', 'DELETED', 'DEADLINE']::"NotificationType"[];

-- A new notification type is on by default (the column default above). Rows that already
-- exist keep their old list, so add it there too, or the reminders would be silently dropped.
UPDATE "SystemSettings" SET "enabledNotificationTypes" = array_append("enabledNotificationTypes", 'DEADLINE'::"NotificationType")
WHERE NOT ('DEADLINE'::"NotificationType" = ANY("enabledNotificationTypes"));

-- CreateIndex
CREATE INDEX "TodoItem_dueDate_idx" ON "TodoItem"("dueDate");
