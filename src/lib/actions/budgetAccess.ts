"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import type { SessionPayload } from "@/lib/jwt";
import { requireBoardAdmin } from "@/lib/permissions";
import { logAudit } from "@/lib/activityLog";
import { requireBoardAccess } from "@/lib/boardAccess";
import { BUDGET_VIEW_ROLES } from "@/lib/budgetAccess";
import { UserError } from "@/lib/userError";

/**
 * 誰看得到預算金額(規則見 lib/budgetAccess.ts):
 *   - 系統設定挑「可以看預算的組織」,那些組織的主管對所有看板有效(預設);
 *   - 每塊看板另外指名「可以看預算的人」(看板分享設定)。
 * 這裡是這兩處的讀寫。錯誤一律用回傳值帶回去。
 */
type Result = { error?: string };

/** 系統設定:這些組織(組織架構圖的部門)的主管,對所有看板都看得到預算金額。 */
export async function setBudgetViewOrgNodes(nodeIds: string[]): Promise<Result> {
  const session = await requireSession();
  requireBoardAdmin(session.role);
  const ids = [...new Set(nodeIds.filter(Boolean))];
  if (ids.length > 0) {
    const found = await prisma.orgNode.count({ where: { id: { in: ids } } });
    if (found !== ids.length) return { error: "有部門已經不存在了,請重新整理頁面再選一次" };
  }
  const nodes = await prisma.orgNode.findMany({ where: { id: { in: ids } }, select: { name: true } });
  await prisma.systemSettings.upsert({
    where: { id: "global" },
    create: { id: "global", budgetViewOrgNodeIds: ids },
    update: { budgetViewOrgNodeIds: ids },
  });
  await logAudit(
    "SETTINGS",
    session.userId,
    `預算可見範圍:可以看預算的組織改為 ${nodes.length === 0 ? "(無)" : nodes.map((n) => n.name).join("、")}`
  );
  revalidatePath("/settings");
  revalidatePath("/dashboard");
  return {};
}

/** 管理者,或是這塊看板的擁有者:跟看板分享設定同一個門檻。 */
async function requireOwnerOrAdmin(boardId: string, session: SessionPayload) {
  if (session.role === "ADMIN") return;
  const board = await prisma.board.findUnique({ where: { id: boardId }, select: { ownerId: true } });
  if (board?.ownerId !== session.userId) throw new UserError("權限不足:僅看板擁有者或管理者可以設定誰看得到預算");
}

export type BudgetViewerRow = { userId: string; name: string; email: string };
export type BudgetViewerInfo = {
  viewers: BudgetViewerRow[];
  /** 不用指名、本來就看得到預算的人:擁有者與各專案負責角色的持有人。 */
  inherent: { owner: string | null; roles: { role: string; names: string[] }[] };
};

const ROLE_NAME: Record<string, string> = { TEAM_LEADER: "Team Leader", PMD: "PMD", PM_DM: "PM DM" };

export async function listBoardBudgetViewers(boardId: string): Promise<BudgetViewerInfo> {
  const session = await requireSession();
  await requireBoardAccess(boardId, session);
  await requireOwnerOrAdmin(boardId, session);
  const [rows, board, assignments] = await Promise.all([
    prisma.boardBudgetViewer.findMany({
      where: { boardId },
      include: { user: { select: { id: true, name: true, email: true } } },
      orderBy: { createdAt: "asc" },
    }),
    prisma.board.findUnique({ where: { id: boardId }, select: { owner: { select: { name: true } } } }),
    prisma.groupRoleAssignment.findMany({
      where: { group: { boardId }, role: { in: BUDGET_VIEW_ROLES } },
      select: { role: true, user: { select: { name: true } } },
    }),
  ]);
  const byRole = new Map<string, Set<string>>();
  for (const a of assignments) byRole.set(a.role, (byRole.get(a.role) ?? new Set()).add(a.user.name));
  return {
    viewers: rows.map((r) => ({ userId: r.user.id, name: r.user.name, email: r.user.email })),
    inherent: {
      owner: board?.owner.name ?? null,
      roles: BUDGET_VIEW_ROLES.filter((r) => byRole.has(r)).map((r) => ({ role: ROLE_NAME[r], names: [...(byRole.get(r) ?? [])] })),
    },
  };
}

export async function addBoardBudgetViewer(boardId: string, userId: string): Promise<Result> {
  const session = await requireSession();
  await requireOwnerOrAdmin(boardId, session);
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { name: true } });
  if (!user) return { error: "找不到這位使用者" };
  await prisma.boardBudgetViewer.upsert({
    where: { boardId_userId: { boardId, userId } },
    create: { boardId, userId },
    update: {},
  });
  await logAudit("ACCESS", session.userId, `指名可以看預算的人:加入 ${user.name}`, boardId);
  revalidatePath(`/boards/${boardId}`);
  return {};
}

export async function removeBoardBudgetViewer(boardId: string, userId: string): Promise<Result> {
  const session = await requireSession();
  await requireOwnerOrAdmin(boardId, session);
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { name: true } });
  await prisma.boardBudgetViewer.deleteMany({ where: { boardId, userId } });
  await logAudit("ACCESS", session.userId, `指名可以看預算的人:移除 ${user?.name ?? userId}`, boardId);
  revalidatePath(`/boards/${boardId}`);
  return {};
}
