import { prisma } from "@/lib/prisma";
import type { SessionPayload } from "@/lib/jwt";
import { accessibleBoardWhere } from "@/lib/boardAccess";
import { visibleItemIdsForBoards } from "@/lib/serverVisibility";
import { computeWbsCodes } from "@/lib/wbs";
import type { ItemEventKind } from "@/lib/itemEvents";

/** 「更新記錄」頁的一筆:誰在哪個看板的哪個工作項做了什麼。 */
export type UpdateFeedRow = {
  id: string;
  kind: ItemEventKind;
  /** ISO 字串 */
  at: string;
  actorName: string | null;
  summary: string;
  itemId: string;
  itemName: string;
  wbsCode: string;
  boardId: string;
  boardName: string;
  groupName: string;
};

/**
 * 這個人看得到的所有看板上,所有人對工作項的更新與變化(狀態切換、留言、連結、待辦事項、其他欄位修改),
 * 新的在前。跟通知不同:通知只有「跟我有關」的,這裡是整個看板上發生的事。
 *
 * 看得到哪些看板、哪些工作項照畫面一樣(私人項目、DM 的可見範圍都會擋),垃圾桶裡的工作項不列。
 * 多撈一些再過濾,因為過濾掉看不到的之後還要湊得到 limit 筆。
 */
export async function loadUpdateFeed(session: SessionPayload, limit = 200): Promise<UpdateFeedRow[]> {
  const boards = await prisma.board.findMany({ where: accessibleBoardWhere(session), select: { id: true } });
  const boardIds = boards.map((b) => b.id);
  if (boardIds.length === 0) return [];

  const [rows, visible] = await Promise.all([
    prisma.activityLogEntry.findMany({
      where: { boardId: { in: boardIds }, itemId: { not: null }, eventKind: { not: null }, item: { deletedAt: null } },
      orderBy: { createdAt: "desc" },
      take: limit * 3,
      select: {
        id: true,
        eventKind: true,
        createdAt: true,
        message: true,
        itemId: true,
        actor: { select: { name: true } },
        item: { select: { name: true, groupId: true, boardId: true, board: { select: { name: true } }, group: { select: { name: true } } } },
      },
    }),
    visibleItemIdsForBoards(boardIds, session),
  ]);
  const shown = rows.filter((r) => r.itemId && visible.has(r.itemId)).slice(0, limit);

  // WBS 編號不存在資料庫:是項目在自己分組樹裡的位置,一個分組算一次(跟通知列表同一個做法)。
  const groupIds = [...new Set(shown.map((r) => r.item!.groupId))];
  const groupItems = groupIds.length
    ? await prisma.item.findMany({
        where: { groupId: { in: groupIds }, deletedAt: null },
        select: { id: true, parentId: true, order: true, groupId: true },
      })
    : [];
  const byGroup = new Map<string, typeof groupItems>();
  for (const item of groupItems) byGroup.set(item.groupId, [...(byGroup.get(item.groupId) ?? []), item]);
  const wbsByGroup = new Map([...byGroup].map(([groupId, items]) => [groupId, computeWbsCodes(items)]));

  return shown.map((r) => ({
    id: r.id,
    kind: r.eventKind as ItemEventKind,
    at: r.createdAt.toISOString(),
    actorName: r.actor?.name ?? null,
    summary: r.message,
    itemId: r.itemId!,
    itemName: r.item!.name,
    wbsCode: wbsByGroup.get(r.item!.groupId)?.get(r.itemId!) ?? "",
    boardId: r.item!.boardId,
    boardName: r.item!.board.name,
    groupName: r.item!.group.name,
  }));
}
