"use server";

import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { requireItemBoardAccess } from "@/lib/boardAccess";
import { canEditGanttItem, canModifyItemSchedule } from "@/lib/permissions";
import { isItemAssignedToUser, isItemAssignedToTeam } from "@/lib/itemAssignment";
import { loadGroupRoleContext } from "@/lib/groupRoleContext";
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
      where: { groupId: item.groupId, deletedAt: null },
      orderBy: { order: "asc" },
      include: itemInclude,
    }),
    prisma.column.findMany({ where: { boardId, type: "PERSON" }, select: { id: true } }),
    loadGroupRoleContext(item.groupId, session.userId),
    session.role === "SUPERVISOR"
      ? prisma.user.findMany({ where: { supervisorId: session.userId }, select: { id: true } })
      : Promise.resolve([]),
  ]);

  const personColumnIds = personColumns.map((c) => c.id);
  const teamUserIds = new Set(supervisedUsers.map((u) => u.id));
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
