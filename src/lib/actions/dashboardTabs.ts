"use server";

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { sanitizeDashboardTabs, type DashboardTab } from "@/lib/dashboardTabs";

/**
 * 存這個人自己的儀表板子類(分頁)與每個區塊歸在哪一類(只影響他自己看到的)。空清單 = 只剩「全部」。
 * 管理者代操作別人的帳號時不能改——那是對方自己的偏好(跟區塊順序同一個規則)。
 * 用回傳值帶錯誤,不丟例外:production 的 Next.js 會把丟出來的訊息洗掉。
 */
export async function saveDashboardTabs(tabs: DashboardTab[]): Promise<{ error?: string }> {
  const session = await requireSession();
  if (session.impersonatorId) return { error: "代操作別人的帳號時,不能改對方的儀表板分頁" };
  const clean = sanitizeDashboardTabs(tabs);
  await prisma.user.update({
    where: { id: session.userId },
    data: { dashboardTabs: clean.length === 0 ? Prisma.DbNull : clean },
  });
  return {};
}
