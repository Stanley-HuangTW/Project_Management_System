-- AlterTable
ALTER TABLE "Group" ADD COLUMN     "memberOverrides" "GroupDiscipline"[] DEFAULT ARRAY[]::"GroupDiscipline"[],
ADD COLUMN     "resourceOverride" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "BoardDisciplineMember" (
    "id" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "discipline" "GroupDiscipline" NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "BoardDisciplineMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BoardResourceMember" (
    "id" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,

    CONSTRAINT "BoardResourceMember_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BoardDisciplineMember_userId_idx" ON "BoardDisciplineMember"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "BoardDisciplineMember_boardId_discipline_userId_key" ON "BoardDisciplineMember"("boardId", "discipline", "userId");

-- CreateIndex
CREATE INDEX "BoardResourceMember_resourceId_idx" ON "BoardResourceMember"("resourceId");

-- CreateIndex
CREATE UNIQUE INDEX "BoardResourceMember_boardId_resourceId_key" ON "BoardResourceMember"("boardId", "resourceId");

-- AddForeignKey
ALTER TABLE "BoardDisciplineMember" ADD CONSTRAINT "BoardDisciplineMember_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "Board"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoardDisciplineMember" ADD CONSTRAINT "BoardDisciplineMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoardResourceMember" ADD CONSTRAINT "BoardResourceMember_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "Board"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoardResourceMember" ADD CONSTRAINT "BoardResourceMember_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "Resource"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- 這個功能上線之前,每個分組的實作成員與 Resource 成員都是各自設定的。把已經有名單的職能標成
-- 「分組自己設定」,看板層級的名單(一開始是空的)才不會把它們洗掉;沒設過的維持原樣(沒有人)。
UPDATE "Group" g
SET "memberOverrides" = COALESCE(
      (SELECT array_agg(DISTINCT m."discipline") FROM "GroupMember" m WHERE m."groupId" = g."id"),
      ARRAY[]::"GroupDiscipline"[]
    ),
    "resourceOverride" = EXISTS (SELECT 1 FROM "GroupResourceMember" r WHERE r."groupId" = g."id");
