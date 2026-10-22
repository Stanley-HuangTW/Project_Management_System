"use server";

import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { sanitizeDashboardOrder } from "@/lib/dashboardSections";

/**
 * 存這個人自己排的儀表板區塊順序(只影響他自己看到的)。ids 是畫面上由上到下的區塊 id;空清單 = 還原成預設。
 * 管理者代操作別人的帳號時不能改——那是對方自己的偏好(跟側邊欄順序同一個規則)。
 * 用回傳值帶錯誤,不丟例外:production 的 Next.js 會把丟出來的訊息洗掉。
 */
export async function saveDashboardOrder(ids: string[]): Promise<{ error?: string }> {
  const session = await requireSession();
  if (session.impersonatorId) return { error: "代操作別人的帳號時,不能改對方的儀表板順序" };
  await prisma.user.update({
    where: { id: session.userId },
    data: { dashboardOrder: sanitizeDashboardOrder(ids) },
  });
  return {};
}
