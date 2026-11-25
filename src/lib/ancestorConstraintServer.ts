import { prisma } from "@/lib/prisma";
import { getItemDateRange } from "@/lib/gantt";
import { listHolidays, toHolidaySet } from "@/lib/holidays";
import { ancestorConstraintLines, type ConstraintNode } from "@/lib/ancestorConstraint";

async function loadNodes(boardId: string): Promise<ConstraintNode[]> {
  const items = await prisma.item.findMany({
    where: { boardId, deletedAt: null },
    select: { id: true, parentId: true, name: true, constraintType: true, constraintDate: true },
  });
  return items.map((i) => ({ id: i.id, parentId: i.parentId, name: i.name, constraintType: i.constraintType, constraintDate: i.constraintDate }));
}

/** 這次調整後,這幾個項目的起訖日有沒有超出它們上層(摘要)項目的日期約束;回傳提醒文字(沒有就是空陣列)。 */
export async function ancestorConstraintWarnings(boardId: string, edits: { itemId: string; start: string; end: string }[]): Promise<string[]> {
  if (edits.length === 0) return [];
  return ancestorConstraintLines(await loadNodes(boardId), edits);
}

/** 已經存好之後:這個項目現在的起訖日有沒有超出上層的日期約束。 */
export async function ancestorConstraintWarningsForItem(boardId: string, itemId: string): Promise<string[]> {
  const [board, item] = await Promise.all([
    prisma.board.findUnique({
      where: { id: boardId },
      select: { ganttStartColumnId: true, ganttDurationColumnId: true, ganttDurationMode: true },
    }),
    prisma.item.findUnique({ where: { id: itemId }, select: { id: true, cellValues: true } }),
  ]);
  if (!board?.ganttStartColumnId || !board.ganttDurationColumnId || !item) return [];
  const holidays = toHolidaySet(await listHolidays());
  const range = getItemDateRange(item, board.ganttStartColumnId, board.ganttDurationColumnId, board.ganttDurationMode, holidays);
  if (!range) return [];
  return ancestorConstraintWarnings(boardId, [
    { itemId, start: range.start.toISOString().slice(0, 10), end: range.end.toISOString().slice(0, 10) },
  ]);
}
