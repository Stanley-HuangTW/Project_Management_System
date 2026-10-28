"use server";

import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { requireBoardAccess, requireItemBoardAccess } from "@/lib/boardAccess";
import { suggestItemAssignee, suggestRiskAssignee } from "@/lib/todoAssigneeServer";
import type { AssigneeReason } from "@/lib/todoAssignee";

/** 待辦事項處理者的人選:公司所有人員(依名字排)。 */
export async function listAssignableUsers(): Promise<{ id: string; name: string }[]> {
  await requireSession();
  return prisma.user.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } });
}

/**
 * 這個待辦事項預設由誰處理(規則見 lib/todoAssignee):文字裡 @ 的人 → 負責人 → 人員分配工作量比例最高的人 →
 * 登記工時最多的人。給畫面預先帶入處理者用(可以再改);看不到那個看板就回「沒有預設」。
 */
export async function suggestTodoAssignee(
  target: { kind: "item" | "risk"; id: string },
  text: string
): Promise<{ userId: string | null; reason: AssigneeReason | null }> {
  const session = await requireSession();
  try {
    if (target.kind === "item") await requireItemBoardAccess(target.id, session);
    else {
      const risk = await prisma.riskEntry.findUnique({ where: { id: target.id }, select: { boardId: true } });
      if (!risk) return { userId: null, reason: null };
      await requireBoardAccess(risk.boardId, session);
    }
  } catch {
    return { userId: null, reason: null };
  }
  const found = target.kind === "item" ? await suggestItemAssignee(target.id, text) : await suggestRiskAssignee(target.id, text);
  return { userId: found?.userId ?? null, reason: found?.reason ?? null };
}
