-- CreateEnum
CREATE TYPE "RowVisibility" AS ENUM ('PUBLIC', 'PRIVATE');

-- AlterTable
-- 分組與工作項的可見範圍。既有資料一律 PUBLIC:上線不會讓任何人少看到東西。
ALTER TABLE "Group" ADD COLUMN     "visibility" "RowVisibility" NOT NULL DEFAULT 'PUBLIC';
ALTER TABLE "Group" ADD COLUMN     "createdById" TEXT;
ALTER TABLE "Item" ADD COLUMN     "visibility" "RowVisibility" NOT NULL DEFAULT 'PUBLIC';

-- CreateTable
CREATE TABLE "ItemViewer" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "ItemViewer_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "GroupViewer" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "GroupViewer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ItemViewer_itemId_userId_key" ON "ItemViewer"("itemId", "userId");
CREATE UNIQUE INDEX "GroupViewer_groupId_userId_key" ON "GroupViewer"("groupId", "userId");

-- AddForeignKey
ALTER TABLE "ItemViewer" ADD CONSTRAINT "ItemViewer_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ItemViewer" ADD CONSTRAINT "ItemViewer_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GroupViewer" ADD CONSTRAINT "GroupViewer_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GroupViewer" ADD CONSTRAINT "GroupViewer_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
