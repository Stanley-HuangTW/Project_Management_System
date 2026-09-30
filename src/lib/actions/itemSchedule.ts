"use server";

import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { requireItemBoardAccess } from "@/lib/boardAccess";
import { canEditGanttItem, canModifyItemSchedule } from "@/lib/permissions";
import { isItemAssignedToUser, isItemAssignedToTeam } from "@/lib/itemAssignment";
import { loadGroupRoleContext } from "@/lib/groupRoleContext";
import { subordinateIdsOf } from "@/lib/orgChartServer";
import type { ColumnData, ItemData } from "@/types/board";

export type ItemScheduleContext = {
  item: ItemData;
  columns: ColumnData[];
  /** Every item in the same group, for the Pred dropdown's WBS codes. */
  groupItems: ItemData[];
  predColumnId: string | null;
  linkColumnId: string | null;
  lagColumnId: string | null;
  /** The board's real manual-duration input, falling back to Days — the same
   *  choice the Gantt makes when it opens this modal. */
  durationColumnId: string | null;
  manualStartColumnId: string | null;
  ganttStartColumnId: string | null;
  ganttEndColumnId: string | null;
  /** Whether the Pred/Link/Lag/duration fields are editable, not whether the
   *  modal opens — assignments have their own, looser check. */
  canEditSchedule: boolean;
};

const itemInclude = {
  cellValues: true,
  viewers: { select: { userId: true } },
  _count: { select: { comments: true } },
  assignments: { include: { user: { select: { id: true, name: true } } } },
} as const;

/**
 * Everything the 人員分配 modal needs for one item, loaded when it opens.
 * The dashboard carries only a thin projection of each member task, and
 * shipping every item's board with the page would dwarf what it renders —
 * so the modal's data is fetched per click instead.
 * Returns null when the caller can't open the modal for this item at all.
 */
export async function loadItemScheduleContext(itemId: string): Promise<ItemScheduleContext | null> {
  const session = await requireSession();
  const boardId = await requireItemBoardAccess(itemId, session);

  const [item, board] = await Promise.all([
    prisma.item.findUnique({ where: { id: itemId }, include: itemInclude }),
    prisma.board.findUnique({
      where: { id: boardId },
      select: {
        predColumnId: true,
        linkColumnId: true,
        lagColumnId: true,
        ganttStartColumnId: true,
        ganttDurationColumnId: true,
        ganttEndColumnId: true,
        manualStartColumnId: true,
        manualDurationColumnId: true,
        columns: { orderBy: { order: "asc" } },
      },
    }),
  ]);
  if (!item || !board) return null;

  const [groupItems, personColumns, groupRole, supervisedUsers] = await Promise.all([
    prisma.item.findMany({
      where: { boardId: item.boardId, deletedAt: null },
      orderBy: { order: "asc" },
      include: itemInclude,
    }),
    prisma.column.findMany({ where: { boardId, type: "PERSON" }, select: { id: true } }),
    loadGroupRoleContext(item.groupId, session.userId),
    session.role === "SUPERVISOR"
      ? subordinateIdsOf(session.userId)
      : Promise.resolve(new Set<string>()),
  ]);

  const personColumnIds = personColumns.map((c) => c.id);
  const teamUserIds = supervisedUsers;
  const hasScheduleRole = groupRole?.access.hasScheduleRole ?? false;
  const canOpen = canEditGanttItem(
    session.role,
    isItemAssignedToUser(item, personColumnIds, session.userId),
    isItemAssignedToTeam(item, personColumnIds, teamUserIds) ||
      (!!groupRole && isItemAssignedToTeam(item, personColumnIds, groupRole.teamUserIds)),
    hasScheduleRole
  );
  if (!canOpen) return null;

  return {
    item,
    columns: board.columns,
    groupItems,
    predColumnId: board.predColumnId,
    linkColumnId: board.linkColumnId,
    lagColumnId: board.lagColumnId,
    durationColumnId: board.manualDurationColumnId ?? board.ganttDurationColumnId,
    manualStartColumnId: board.manualStartColumnId,
    ganttStartColumnId: board.ganttStartColumnId,
    ganttEndColumnId: board.ganttEndColumnId,
    canEditSchedule: canModifyItemSchedule(session.role, item.createdById, session.userId, hasScheduleRole),
  };
}

export type ItemDetailContext = {
  boardId: string;
  item: ItemData;
  columns: ColumnData[];
  groupItems: ItemData[];
  progressColumnId: string | null;
  predColumnId: string | null;
  linkColumnId: string | null;
  ganttStartColumnId: string | null;
  ganttDurationColumnId: string | null;
  ganttEndColumnId: string | null;
};

/**
 * 給儀表板的成員工作量明細用——點一個任務直接跳出項目卡片彈窗,不用跳轉
 * 到那個看板的表格畫面。只要求一般的看板存取權,不是 loadItemScheduleContext
 * 那個「能不能改時程」的窄權限(儀表板上看得到這個任務的人,不代表也能拖
 * 甘特圖,但還是該看得到卡片內容、能留言)。
 */
export async function loadItemDetailContext(itemId: string): Promise<ItemDetailContext | null> {
  const session = await requireSession();
  const boardId = await requireItemBoardAccess(itemId, session);

  const [item, board] = await Promise.all([
    prisma.item.findUnique({ where: { id: itemId }, include: itemInclude }),
    prisma.board.findUnique({
      where: { id: boardId },
      select: {
        progressColumnId: true,
        predColumnId: true,
        linkColumnId: true,
        ganttStartColumnId: true,
        ganttDurationColumnId: true,
        ganttEndColumnId: true,
        columns: { orderBy: { order: "asc" } },
      },
    }),
  ]);
  if (!item || !board) return null;

  const groupItems = await prisma.item.findMany({
    where: { boardId: item.boardId, deletedAt: null },
    orderBy: { order: "asc" },
    include: itemInclude,
  });

  return {
    boardId,
    item,
    columns: board.columns,
    groupItems,
    progressColumnId: board.progressColumnId,
    predColumnId: board.predColumnId,
    linkColumnId: board.linkColumnId,
    ganttStartColumnId: board.ganttStartColumnId,
    ganttDurationColumnId: board.ganttDurationColumnId,
    ganttEndColumnId: board.ganttEndColumnId,
  };
}
