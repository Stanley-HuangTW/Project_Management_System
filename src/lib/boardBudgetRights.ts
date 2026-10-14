import { prisma } from "@/lib/prisma";
import type { SessionPayload } from "@/lib/jwt";

/**
 * 預算、樣機計畫、樣機 BOM 的編輯權——這幾張表是整塊看板的(階段橫跨所有分組),所以問的是
 * 「這塊看板」:管理者、看板擁有者,或這塊看板任一分組的 Team Leader。跟階段預算(canEditBudget 的
 * phase)同一條規則。以前樣機計畫與 BOM 只問最上層第一列工作項所在的那一個分組,Team Leader 掛在
 * 別的分組就改不了,而同一個人卻改得了階段預算。
 */
export async function canEditBoardBudget(
  boardId: string,
  session: Pick<SessionPayload, "userId" | "role">
): Promise<boolean> {
  if (session.role === "ADMIN") return true;
  const board = await prisma.board.findUnique({ where: { id: boardId }, select: { ownerId: true } });
  if (!board) return false;
  if (board.ownerId === session.userId) return true;
  const leads = await prisma.groupRoleAssignment.count({
    where: { userId: session.userId, role: "TEAM_LEADER", group: { boardId } },
  });
  return leads > 0;
}
