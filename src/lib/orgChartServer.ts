import { prisma } from "@/lib/prisma";
import { subordinateIds, teamViewIds } from "@/lib/orgChart";
import { loadDelegations } from "@/lib/approvalLevelsServer";

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
 * 儀表板這類「我的團隊」畫面要看哪些人:主管看自己加下轄,副主管看他代簽的主管的下轄加自己
 * (規則見 teamViewIds)。回 null = 這個人沒有團隊可看。只決定「看得到誰」,管理權限(指派、改時程)不變。
 */
export async function teamViewIdsOf(
  session: { userId: string; role: "ADMIN" | "SUPERVISOR" | "MEMBER" },
  users: { id: string; supervisorId?: string | null }[]
): Promise<Set<string> | null> {
  const principals = (await loadDelegations()).get(session.userId) ?? [];
  return teamViewIds(users, session.userId, { isSupervisor: session.role === "SUPERVISOR", principals });
}
