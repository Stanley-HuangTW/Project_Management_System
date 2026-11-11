-- AlterTable
ALTER TABLE "Board" ADD COLUMN     "ganttPausedColor" TEXT NOT NULL DEFAULT '#fdab3d';

-- AlterTable
ALTER TABLE "SystemSettings" ADD COLUMN     "ganttPausedColor" TEXT NOT NULL DEFAULT '#fdab3d';
