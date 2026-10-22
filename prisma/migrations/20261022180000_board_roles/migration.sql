-- AlterTable
ALTER TABLE "Group" ADD COLUMN     "roleOverrides" "GroupRole"[] DEFAULT ARRAY[]::"GroupRole"[];

-- CreateTable
CREATE TABLE "BoardRoleAssignment" (
    "id" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "role" "GroupRole" NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "BoardRoleAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BoardRoleAssignment_userId_idx" ON "BoardRoleAssignment"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "BoardRoleAssignment_boardId_role_userId_key" ON "BoardRoleAssignment"("boardId", "role", "userId");

-- AddForeignKey
ALTER TABLE "BoardRoleAssignment" ADD CONSTRAINT "BoardRoleAssignment_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "Board"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoardRoleAssignment" ADD CONSTRAINT "BoardRoleAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- 這個功能上線之前,每個分組的角色都是各自設定的。把已經有名單的角色標成「分組自己設定」,
-- 看板層級的角色(一開始是空的)才不會把它們洗掉;沒設過的角色維持原樣(沒有人)。
UPDATE "Group" g
SET "roleOverrides" = COALESCE(
  (SELECT array_agg(DISTINCT a."role") FROM "GroupRoleAssignment" a WHERE a."groupId" = g."id"),
  ARRAY[]::"GroupRole"[]
);
