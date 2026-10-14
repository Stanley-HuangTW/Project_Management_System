"use server";

import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { sanitizeOrder } from "@/lib/sidebarOrder";

/**
 * 存這個人自己排的側邊欄順序(只影響他自己看到的)。ids 是畫面上由上到下的 id;沒有出現在清單裡的
 * 看板或群組之後接在最後。管理者代操作別人的帳號時不能改——那是對方自己的偏好。
 */
export async function saveSidebarOrder(kind: "board" | "program", ids: string[]): Promise<{ error?: string }> {
  const session = await requireSession();
  if (session.impersonatorId) return { error: "代操作別人的帳號時,不能改對方的側邊欄順序" };
  const order = sanitizeOrder(ids);
  await prisma.user.update({
    where: { id: session.userId },
    data: kind === "board" ? { boardOrder: order } : { programOrder: order },
  });
  return {};
}
