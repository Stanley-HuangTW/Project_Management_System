import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { planGroupRoleSync, planGroupRosterSync } from "@/lib/boardRoles";

type Db = Prisma.TransactionClient | typeof prisma;

/**
 * 把看板的角色、實作成員、Resource 成員名單複製到「沒有自己設定」的分組(實際生效的權限讀的是
 * GroupRoleAssignment / GroupMember,所以沿用看板的部分,那裡的列就是看板名單的複本)。看板名單改了、
 * 分組剛建立、某個角色 / 職能 / Resource 改回「沿用看板」之後都要跑;重複跑沒有副作用。
 * groupId 有給就只同步那一個分組。
 */
export async function syncGroupRolesFromBoard(boardId: string, options: { groupId?: string } = {}, db: Db = prisma): Promise<void> {
  const [boardRows, boardMembers, boardResources, groups] = await Promise.all([
    db.boardRoleAssignment.findMany({ where: { boardId }, select: { role: true, userId: true } }),
    db.boardDisciplineMember.findMany({ where: { boardId }, select: { discipline: true, userId: true } }),
    db.boardResourceMember.findMany({ where: { boardId }, select: { resourceId: true } }),
    db.group.findMany({
      where: { boardId, ...(options.groupId ? { id: options.groupId } : {}) },
      select: {
        id: true,
        roleOverrides: true,
        memberOverrides: true,
        resourceOverride: true,
        roleAssignments: { select: { role: true, userId: true } },
        members: { select: { discipline: true, userId: true } },
        resourceMembers: { select: { resourceId: true } },
      },
    }),
  ]);
  const plan = planGroupRoleSync(
    boardRows,
    groups.map((g) => ({ id: g.id, overrides: g.roleOverrides, rows: g.roleAssignments }))
  );
  if (plan.remove.length > 0) {
    await db.groupRoleAssignment.deleteMany({
      where: { OR: plan.remove.map((r) => ({ groupId: r.groupId, role: r.role, userId: r.userId })) },
    });
  }
  if (plan.add.length > 0) {
    await db.groupRoleAssignment.createMany({ data: plan.add, skipDuplicates: true });
  }

  const roster = planGroupRosterSync(
    boardMembers,
    boardResources.map((r) => r.resourceId),
    groups.map((g) => ({
      id: g.id,
      memberOverrides: g.memberOverrides,
      resourceOverride: g.resourceOverride,
      members: g.members,
      resourceIds: g.resourceMembers.map((r) => r.resourceId),
    }))
  );
  if (roster.removeMembers.length > 0) {
    await db.groupMember.deleteMany({
      where: { OR: roster.removeMembers.map((m) => ({ groupId: m.groupId, discipline: m.discipline, userId: m.userId })) },
    });
  }
  if (roster.addMembers.length > 0) {
    await db.groupMember.createMany({ data: roster.addMembers, skipDuplicates: true });
  }
  if (roster.removeResources.length > 0) {
    await db.groupResourceMember.deleteMany({
      where: { OR: roster.removeResources.map((r) => ({ groupId: r.groupId, resourceId: r.resourceId })) },
    });
  }
  if (roster.addResources.length > 0) {
    await db.groupResourceMember.createMany({ data: roster.addResources, skipDuplicates: true });
  }
}
