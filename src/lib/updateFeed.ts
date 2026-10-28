import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { SessionPayload } from "@/lib/jwt";
import { accessibleBoardWhere } from "@/lib/boardAccess";
import { visibleItemIdsForBoards } from "@/lib/serverVisibility";
import { computeWbsCodes } from "@/lib/wbs";
import { riskLinkTag } from "@/lib/riskRegister";
import type { ItemEventKind } from "@/lib/itemEvents";

/** 「更新記錄」頁的一筆:誰在哪個看板的哪個工作項(或風險 / 議題)做了什麼。 */
export type UpdateFeedRow = {
  id: string;
  kind: ItemEventKind;
  /** ISO 字串 */
  at: string;
  actorName: string | null;
  summary: string;
  /** 風險 / 議題的事件沒有工作項,itemId 是空字串、itemName 是風險的標題。 */
  itemId: string;
  itemName: string;
  wbsCode: string;
  boardId: string;
  boardName: string;
  /** 工作項是分組名稱;風險 / 議題是它是什麼(風險 / 議題 / Mantis #編號)。 */
  groupName: string;
  /** 風險 / 議題的事件才有。 */
  risk: { id: string; kind: "RISK" | "ISSUE"; mantisId: number | null } | null;
  /** 跟目前這個帳號有關:是我做的,或發生在指派給我的工作項 / 我負責或審核的風險與議題上。 */
  mine: boolean;
};

/**
 * 這個人看得到的所有看板上,所有人對工作項(狀態切換、留言、連結、待辦事項、其他欄位修改)與風險 / 議題
 * (新增、指派、變更、申請結案、審核)的更新與變化,新的在前。跟通知不同:通知只有「跟我有關」的,
 * 這裡是整個看板上發生的事;每一筆標了 mine,畫面預設只看跟我有關的。
 *
 * 看得到哪些看板、哪些工作項照畫面一樣(私人項目、DM 的可見範圍都會擋),垃圾桶裡的工作項不列。風險登記冊本來就是
 * 看板成員都看得到,沒有另外的可見範圍。多撈一些再過濾,因為過濾掉看不到的之後還要湊得到 limit 筆。
 */
export async function loadUpdateFeed(session: SessionPayload, limit = 200): Promise<UpdateFeedRow[]> {
  const boards = await prisma.board.findMany({ where: accessibleBoardWhere(session), select: { id: true } });
  const boardIds = boards.map((b) => b.id);
  if (boardIds.length === 0) return [];
  const me = session.userId;

  // 跟我有關的工作項(指派給我:甘特的人員分配或人員欄位)與風險 / 議題(我是負責人或審核人)。
  const [assignments, personCells, myRisks] = await Promise.all([
    prisma.assignment.findMany({ where: { userId: me, item: { boardId: { in: boardIds }, deletedAt: null } }, select: { itemId: true } }),
    prisma.cellValue.findMany({
      where: {
        column: { type: "PERSON", boardId: { in: boardIds } },
        item: { deletedAt: null },
        OR: [{ value: { equals: me } }, { value: { array_contains: me } }],
      },
      select: { itemId: true },
    }),
    prisma.riskEntry.findMany({
      where: { boardId: { in: boardIds }, OR: [{ ownerId: me }, { reviewers: { some: { userId: me } } }] },
      select: { id: true },
    }),
  ]);
  const myItemIds = new Set([...assignments.map((a) => a.itemId), ...personCells.map((c) => c.itemId)]);
  const myRiskIds = new Set(myRisks.map((r) => r.id));

  const base: Prisma.ActivityLogEntryWhereInput = {
    boardId: { in: boardIds },
    OR: [{ itemId: { not: null }, eventKind: { not: null }, item: { deletedAt: null } }, { riskId: { not: null } }],
  };
  const select = {
    id: true,
    eventKind: true,
    createdAt: true,
    message: true,
    actorId: true,
    itemId: true,
    riskId: true,
    actor: { select: { name: true } },
    item: { select: { name: true, groupId: true, boardId: true, board: { select: { name: true } }, group: { select: { name: true } } } },
    risk: { select: { id: true, title: true, kind: true, mantisId: true, boardId: true, board: { select: { name: true } } } },
  } as const;

  const [recent, related, visible] = await Promise.all([
    prisma.activityLogEntry.findMany({ where: base, orderBy: { createdAt: "desc" }, take: limit * 3, select }),
    // 跟我有關的另外撈一次:全部的最近 N 筆被別人的事擠滿時,我自己的舊一點的事也不會不見。
    prisma.activityLogEntry.findMany({
      where: {
        AND: [base, { OR: [{ actorId: me }, { itemId: { in: [...myItemIds] } }, { riskId: { in: [...myRiskIds] } }] }],
      },
      orderBy: { createdAt: "desc" },
      take: limit * 2,
      select,
    }),
    visibleItemIdsForBoards(boardIds, session),
  ]);

  const byId = new Map([...recent, ...related].map((r) => [r.id, r]));
  const isMine = (r: (typeof recent)[number]) =>
    r.actorId === me || (r.itemId !== null && myItemIds.has(r.itemId)) || (r.riskId !== null && myRiskIds.has(r.riskId));
  // 工作項的事件要看得到那個工作項;風險 / 議題的事件沒有這個限制。
  const shown = [...byId.values()]
    .filter((r) => (r.itemId ? visible.has(r.itemId) : r.riskId !== null))
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, limit * 2);

  // WBS 編號不存在資料庫:是項目在自己分組樹裡的位置,一個分組算一次(跟通知列表同一個做法)。
  const groupIds = [...new Set(shown.flatMap((r) => (r.item ? [r.item.groupId] : [])))];
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
    kind: (r.eventKind ?? "FIELD") as ItemEventKind,
    at: r.createdAt.toISOString(),
    actorName: r.actor?.name ?? null,
    summary: r.message,
    itemId: r.itemId ?? "",
    itemName: r.item?.name ?? r.risk?.title ?? "",
    wbsCode: r.item && r.itemId ? (wbsByGroup.get(r.item.groupId)?.get(r.itemId) ?? "") : "",
    boardId: r.item?.boardId ?? r.risk?.boardId ?? "",
    boardName: r.item?.board.name ?? r.risk?.board.name ?? "",
    groupName: r.item?.group.name ?? (r.risk ? riskLinkTag(r.risk) : ""),
    risk: r.risk ? { id: r.risk.id, kind: r.risk.kind, mantisId: r.risk.mantisId } : null,
    mine: isMine(r),
  }));
}
