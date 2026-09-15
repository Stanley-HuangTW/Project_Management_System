import { prisma } from "@/lib/prisma";
import { subordinateIds } from "@/lib/orgChart";

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
