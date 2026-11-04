-- CreateTable
CREATE TABLE "BomAttachment" (
    "id" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "bomLineId" TEXT NOT NULL,
    "columnId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "uploaderId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BomAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BomAttachment_bomLineId_columnId_idx" ON "BomAttachment"("bomLineId", "columnId");

-- CreateIndex
CREATE INDEX "BomAttachment_boardId_idx" ON "BomAttachment"("boardId");

-- AddForeignKey
ALTER TABLE "BomAttachment" ADD CONSTRAINT "BomAttachment_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "Board"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BomAttachment" ADD CONSTRAINT "BomAttachment_bomLineId_fkey" FOREIGN KEY ("bomLineId") REFERENCES "BomLine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BomAttachment" ADD CONSTRAINT "BomAttachment_uploaderId_fkey" FOREIGN KEY ("uploaderId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
