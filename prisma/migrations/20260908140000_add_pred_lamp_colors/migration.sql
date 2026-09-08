-- AlterTable
-- The Pred lamp: green when the predecessor is done (this task may start),
-- orange while it is still running (this task waits), red once it is overdue
-- (this task is blocked). Mirrored onto Board the same way the Gantt status
-- colors are, so every view that already has the board can read them.
ALTER TABLE "SystemSettings" ADD COLUMN     "predReadyColor" TEXT NOT NULL DEFAULT '#00c875';
ALTER TABLE "SystemSettings" ADD COLUMN     "predWaitingColor" TEXT NOT NULL DEFAULT '#fdab3d';
ALTER TABLE "SystemSettings" ADD COLUMN     "predBlockedColor" TEXT NOT NULL DEFAULT '#e2445c';

ALTER TABLE "Board" ADD COLUMN     "predReadyColor" TEXT NOT NULL DEFAULT '#00c875';
ALTER TABLE "Board" ADD COLUMN     "predWaitingColor" TEXT NOT NULL DEFAULT '#fdab3d';
ALTER TABLE "Board" ADD COLUMN     "predBlockedColor" TEXT NOT NULL DEFAULT '#e2445c';
