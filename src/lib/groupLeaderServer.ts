import { prisma } from "@/lib/prisma";

/**
 * 這個人擔任 Team Leader(專案負責人)的分組。看板層級設的 Team Leader 已經複製進每個分組
 * (見 boardRolesServer),所以只要查分組的角色。Team Leader 可以在自己的分組裡指定 DM 與各職能的
 * member(分組角色設定頁),其他角色(Team Leader / PMM / PMD)仍然只有管理者能設。
 */
export async function ledGroupIds(userId: string): Promise<string[]> {
  const rows = await prisma.groupRoleAssignment.findMany({
    where: { userId, role: "TEAM_LEADER", group: { board: { deletedAt: null } } },
    select: { groupId: true },
  });
  return rows.map((r) => r.groupId);
}

export async function isGroupLeader(userId: string, groupId: string): Promise<boolean> {
  const row = await prisma.groupRoleAssignment.findFirst({
    where: { userId, groupId, role: "TEAM_LEADER" },
    select: { id: true },
  });
  return !!row;
}
