"use server";

import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { requireItemBoardAccess } from "@/lib/boardAccess";
import { visibleItemIdsForBoard } from "@/lib/serverVisibility";
import { getStatusOptions } from "@/types/column";
import { classifyStatusOption, pickStatusColumnId, pickStatusTimes, type StatusSwitch } from "@/lib/itemEvents";

export type ItemStatusTimes = {
  started: StatusSwitch | null;
  completed: StatusSwitch | null;
  /** 現在不是完成狀態,但以前切成過完成:最近一次完成的時間。 */
  wasCompleted: StatusSwitch | null;
};

const EMPTY: ItemStatusTimes = { started: null, completed: null, wasCompleted: null };

/**
 * 項目卡片 Status 那一列下面顯示的:什麼時候切成進行中、什麼時候切成完成(誰切的)。
 * 規則跟表格的「進行中時間 / 完成時間」一樣(完成要現在還是完成狀態才算,見 pickStatusTimes)。
 * 看不到的工作項(私人、DM 可見範圍外)回空的。
 */
export async function getItemStatusTimes(itemId: string): Promise<ItemStatusTimes> {
  const session = await requireSession();
  const boardId = await requireItemBoardAccess(itemId, session);
  if (!(await visibleItemIdsForBoard(boardId, session)).has(itemId)) return EMPTY;

  const [rows, columns, board, cells] = await Promise.all([
    prisma.activityLogEntry.findMany({
      where: { itemId, eventKind: "STATUS", statusKind: { in: ["inProgress", "done"] } },
      orderBy: { createdAt: "desc" },
      take: 60,
      select: { statusKind: true, createdAt: true, actor: { select: { name: true } } },
    }),
    prisma.column.findMany({ where: { boardId, type: "STATUS" }, orderBy: { order: "asc" }, select: { id: true, name: true, type: true, options: true } }),
    prisma.board.findUnique({ where: { id: boardId }, select: { reportDoneOptionIds: true } }),
    prisma.cellValue.findMany({ where: { itemId, column: { boardId, type: "STATUS" } }, select: { columnId: true, value: true } }),
  ]);

  const statusColumn = columns.find((c) => c.id === pickStatusColumnId(columns));
  const value = statusColumn ? cells.find((c) => c.columnId === statusColumn.id)?.value : null;
  const option = statusColumn ? getStatusOptions(statusColumn.options).find((o) => o.id === value) : undefined;
  const doneNow = option ? classifyStatusOption(option, board?.reportDoneOptionIds ?? []) === "done" : false;

  return pickStatusTimes(
    rows.map((r) => ({ statusKind: r.statusKind, at: r.createdAt.toISOString(), by: r.actor?.name ?? null })),
    doneNow
  );
}
