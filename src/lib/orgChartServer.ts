import { prisma } from "@/lib/prisma";
import { deputyTeamIds, subordinateIds, teamViewIds } from "@/lib/orgChart";

/**
 * 某個人下轄的所有人,含隔階的部屬。跟畫面端走的是同一個 subordinateIds,
 * 差別只在這裡自己去資料庫拿組織圖 —— 分開放是因為 orgChart.ts 會被
 * client component 匯入,不能碰 prisma。
 *
 * 使用者表很小(整間公司幾十筆),所以整份撈進來走一次,比在資料庫裡遞迴
 * 查詢簡單得多,也不會每多一階就多一次往返。
 */
export async function subordinateIdsOf(userId: string): Promise<Set<string>> {
  const users = await prisma.user.findMany({ select: { id: true, supervisorId: true } });
  return subordinateIds(users, userId);
}

/**
 * 這個人擔任副主管(組織架構圖上勾了「可代簽」)的那幾個部門的人:部門成員加上底下子部門的人,不含部門主管(見 deputyTeamIds)。
 * 不是任何部門的副主管就是空的。
 */
export async function deputyTeamIdsOf(userId: string): Promise<string[]> {
  const roles = await prisma.orgRole.findMany({
    where: { userId, canApprove: true, node: { headId: { not: null } } },
    select: { nodeId: true, node: { select: { headId: true } } },
  });
  // 部門的主管本人不是副主管。
  const unitIds = roles.filter((r) => r.node.headId !== userId).map((r) => r.nodeId);
  if (unitIds.length === 0) return [];
  const [units, members] = await Promise.all([
    prisma.orgNode.findMany({ select: { id: true, parentId: true, headId: true } }),
    prisma.user.findMany({ select: { id: true, orgNodeId: true } }),
  ]);
  return [...deputyTeamIds(units, members, unitIds)];
}

/**
 * 儀表板這類「我的團隊」畫面要看哪些人:主管看自己加下轄,副主管看自己加他負責的部門的人
 * (規則見 teamViewIds)。回 null = 這個人沒有團隊可看。只決定「看得到誰」,管理權限(指派、改時程)不變。
 */
export async function teamViewIdsOf(
  session: { userId: string; role: "ADMIN" | "SUPERVISOR" | "MEMBER" },
  users: { id: string; supervisorId?: string | null }[]
): Promise<Set<string> | null> {
  return teamViewIds(users, session.userId, { isSupervisor: session.role === "SUPERVISOR", deputyTeam: await deputyTeamIdsOf(session.userId) });
}
