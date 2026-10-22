import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { planGroupRoleSync } from "@/lib/boardRoles";

type Db = Prisma.TransactionClient | typeof prisma;

/**
 * 把看板的角色名單複製到「沒有自己設定」的分組(實際生效的權限讀的是 GroupRoleAssignment,
 * 所以沿用看板的角色,那裡的列就是看板名單的複本)。看板名單改了、分組剛建立、
 * 某個角色改回「沿用看板」之後都要跑;重複跑沒有副作用。groupId 有給就只同步那一個分組。
 */
export async function syncGroupRolesFromBoard(boardId: string, options: { groupId?: string } = {}, db: Db = prisma): Promise<void> {
  const [boardRows, groups] = await Promise.all([
    db.boardRoleAssignment.findMany({ where: { boardId }, select: { role: true, userId: true } }),
    db.group.findMany({
      where: { boardId, ...(options.groupId ? { id: options.groupId } : {}) },
      select: { id: true, roleOverrides: true, roleAssignments: { select: { role: true, userId: true } } },
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
}
