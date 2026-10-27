import { prisma } from "@/lib/prisma";

/**
 * Team Leader(專案負責人)可以指定 DM 與各職能的 member 的範圍:
 * - 看板層級的 Team Leader(管理者在「整個看板」設的)= 這整個看板:看板角色、以及這個看板每一個分組;
 * - 分組層級的 Team Leader(只在某個分組)= 那個分組。
 * 其他角色(Team Leader / PMM / PMD)仍然只有管理者能設,Team Leader 自己看到的是鎖住的。
 */

/** 這個人是看板層級 Team Leader 的看板。 */
export async function ledBoardIds(userId: string): Promise<string[]> {
  const rows = await prisma.boardRoleAssignment.findMany({
    where: { userId, role: "TEAM_LEADER", board: { deletedAt: null } },
    select: { boardId: true },
  });
  return rows.map((r) => r.boardId);
}

/** 這個人能管的分組:自己擔任 Team Leader 的分組,加上他是看板層級 Team Leader 的那些看板的所有分組。 */
export async function ledGroupIds(userId: string): Promise<string[]> {
  const boardIds = await ledBoardIds(userId);
  const rows = await prisma.group.findMany({
    where: {
      board: { deletedAt: null },
      OR: [{ roleAssignments: { some: { userId, role: "TEAM_LEADER" } } }, { boardId: { in: boardIds } }],
    },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

export async function isBoardLeader(userId: string, boardId: string): Promise<boolean> {
  const row = await prisma.boardRoleAssignment.findFirst({ where: { userId, boardId, role: "TEAM_LEADER" }, select: { id: true } });
  return !!row;
}

export async function isGroupLeader(userId: string, groupId: string): Promise<boolean> {
  const row = await prisma.groupRoleAssignment.findFirst({ where: { userId, groupId, role: "TEAM_LEADER" }, select: { id: true } });
  if (row) return true;
  // 看板層級的 Team Leader 管這個看板的每一個分組。
  const viaBoard = await prisma.boardRoleAssignment.findFirst({
    where: { userId, role: "TEAM_LEADER", board: { groups: { some: { id: groupId } } } },
    select: { id: true },
  });
  return !!viaBoard;
}
