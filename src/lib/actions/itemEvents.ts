"use server";

import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { requireItemBoardAccess } from "@/lib/boardAccess";
import { visibleItemIdsForBoard } from "@/lib/serverVisibility";
import type { ItemEventKind } from "@/lib/itemEvents";

export type ItemEventRow = {
  id: string;
  kind: ItemEventKind;
  /** ISO 字串 */
  at: string;
  actorName: string | null;
  /** 活動紀錄那一句。 */
  summary: string;
};

/**
 * 一個工作項所有的更新與變化(狀態切換、留言、連結、待辦事項、其他欄位修改),新的在前,最多 100 筆。
 * 「更新記錄」視窗用。看不到的(私人、DM 可見範圍外)工作項回空的,不會從這裡漏出去。
 */
export async function listItemEvents(itemId: string): Promise<ItemEventRow[]> {
  const session = await requireSession();
  const boardId = await requireItemBoardAccess(itemId, session);
  if (!(await visibleItemIdsForBoard(boardId, session)).has(itemId)) return [];

  const rows = await prisma.activityLogEntry.findMany({
    where: { itemId, eventKind: { not: null } },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: { id: true, eventKind: true, createdAt: true, message: true, actor: { select: { name: true } } },
  });
  return rows.map((r) => ({
    id: r.id,
    kind: r.eventKind as ItemEventKind,
    at: r.createdAt.toISOString(),
    actorName: r.actor?.name ?? null,
    summary: r.message,
  }));
}
