-- AlterTable
ALTER TABLE "ActivityLogEntry" ADD COLUMN     "inWeeklyReport" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "todoItemId" TEXT;

-- AlterTable
ALTER TABLE "Comment" ADD COLUMN     "inWeeklyReport" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "ItemLink" ADD COLUMN     "inWeeklyReport" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "TodoItem" ADD COLUMN     "inWeeklyReport" BOOLEAN NOT NULL DEFAULT true;
