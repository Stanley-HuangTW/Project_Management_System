import { prisma } from "@/lib/prisma";
import type { SessionPayload } from "@/lib/jwt";
import { canViewBudget } from "@/lib/budgetAccess";
import { loadDmRestrictions } from "@/lib/dmScopeServer";

/** 他是不是系統設定裡「可以看預算的組織」其中一個的主管(對所有看板都有效)。 */
async function isHeadOfBudgetOrg(userId: string): Promise<boolean> {
  const settings = await prisma.systemSettings.findUnique({ where: { id: "global" }, select: { budgetViewOrgNodeIds: true } });
  const nodeIds = settings?.budgetViewOrgNodeIds ?? [];
  if (nodeIds.length === 0) return false;
  return (await prisma.orgNode.count({ where: { id: { in: nodeIds }, headId: userId } })) > 0;
}

/**
 * 這些看板裡,這個人看得到預算金額的有哪幾塊(規則見 budgetAccess.ts)。
 * 一次問完整串看板——儀表板的預算警示、專案群組這種跨看板的畫面用這個,不用一塊一塊查。
 */
export async function budgetViewableBoardIds(boardIds: string[], session: SessionPayload): Promise<Set<string>> {
  if (boardIds.length === 0) return new Set();
  if (session.role === "ADMIN") return new Set(boardIds);

  const [boards, orgHead, restrictions] = await Promise.all([
    prisma.board.findMany({
      where: { id: { in: boardIds } },
      select: {
        id: true,
        ownerId: true,
        groups: { select: { roleAssignments: { where: { userId: session.userId }, select: { role: true } } } },
        budgetViewers: { where: { userId: session.userId }, select: { id: true } },
      },
    }),
    isHeadOfBudgetOrg(session.userId),
    loadDmRestrictions(boardIds, session),
  ]);
  const viewable = new Set<string>();
  for (const board of boards) {
    const allowed = canViewBudget({
      isAdmin: false,
      isBoardOwner: board.ownerId === session.userId,
      roles: board.groups.flatMap((g) => g.roleAssignments),
      isNamedViewer: board.budgetViewers.length > 0,
      isOrgHead: orgHead,
      dmScopeHidesBudget: restrictions.get(board.id)?.hideBudget === true,
    });
    if (allowed) viewable.add(board.id);
  }
  return viewable;
}

export async function canViewBudgetOn(boardId: string, session: SessionPayload): Promise<boolean> {
  return (await budgetViewableBoardIds([boardId], session)).has(boardId);
}

/** 這個人在這塊看板上看不到預算金額嗎?(階段預算、NRE 報價單、樣機 BOM、人力規劃彙總、成本與 EVM…) */
export async function hideBudgetOn(boardId: string, session: SessionPayload): Promise<boolean> {
  return !(await canViewBudgetOn(boardId, session));
}
