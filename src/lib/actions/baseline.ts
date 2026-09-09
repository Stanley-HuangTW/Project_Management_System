"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { requireBoardAccess } from "@/lib/boardAccess";
import { requireStructureAccess } from "@/lib/permissions";
import { getItemDateRange } from "@/lib/gantt";
import { listHolidays, toHolidaySet } from "@/lib/holidays";

/**
 * Saves every item's current Start/Finish/Days as the plan this board is
 * measured against from now on.
 *
 * Scheduling never touches these again — that is the point: the plan has to
 * stay still while the real dates move, or "how late are we?" has no answer.
 * Re-capturing overwrites the previous baseline, which is what you want after
 * a re-plan and emphatically not something to do casually, so the UI asks.
 *
 * Items with no resolvable dates are cleared rather than left holding a stale
 * baseline from an earlier capture.
 */
export async function captureBaseline(boardId: string): Promise<number> {
  const session = await requireSession();
  await requireBoardAccess(boardId, session);
  requireStructureAccess(session.role);

  const board = await prisma.board.findUnique({
    where: { id: boardId },
    select: { ganttStartColumnId: true, ganttDurationColumnId: true, ganttDurationMode: true },
  });
  if (!board?.ganttStartColumnId || !board.ganttDurationColumnId) {
    throw new Error("此看板尚未設定甘特圖「開始日期」與「天數」欄位,無法建立基準線");
  }

  const [items, holidayRows] = await Promise.all([
    prisma.item.findMany({ where: { boardId, deletedAt: null }, select: { id: true, cellValues: true } }),
    listHolidays(),
  ]);
  const holidays = toHolidaySet(holidayRows);

  let captured = 0;
  const writes = items.map((item) => {
    const range = getItemDateRange(
      item,
      board.ganttStartColumnId!,
      board.ganttDurationColumnId!,
      board.ganttDurationMode,
      holidays
    );
    const daysValue = item.cellValues.find(
      (cv) => cv.columnId === board.ganttDurationColumnId
    )?.value;
    if (range) captured++;
    return prisma.item.update({
      where: { id: item.id },
      data: {
        baselineStart: range ? range.start.toISOString().slice(0, 10) : null,
        baselineEnd: range ? range.end.toISOString().slice(0, 10) : null,
        baselineDays: range && typeof daysValue === "number" ? Math.round(daysValue) : null,
      },
    });
  });

  await prisma.$transaction([
    ...writes,
    prisma.board.update({ where: { id: boardId }, data: { baselineCapturedAt: new Date() } }),
  ]);

  revalidatePath(`/boards/${boardId}`);
  revalidatePath("/settings");
  return captured;
}

/** Drops the saved plan entirely — every comparison stops showing. */
export async function clearBaseline(boardId: string): Promise<void> {
  const session = await requireSession();
  await requireBoardAccess(boardId, session);
  requireStructureAccess(session.role);

  await prisma.$transaction([
    prisma.item.updateMany({
      where: { boardId },
      data: { baselineStart: null, baselineEnd: null, baselineDays: null },
    }),
    prisma.board.update({ where: { id: boardId }, data: { baselineCapturedAt: null } }),
  ]);

  revalidatePath(`/boards/${boardId}`);
  revalidatePath("/settings");
}
