"use server";

import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { requireBoardAccess } from "@/lib/boardAccess";
import { getSystemSettings } from "@/lib/actions/systemSettings";
import { getItemDateRange } from "@/lib/gantt";
import { countDaysInRange } from "@/lib/workday";
import { listHolidays, toHolidaySet } from "@/lib/holidays";
import { labourCost } from "@/lib/cost";
import { computeBoardCost, type CostItemInput, type BoardCostSummary } from "@/lib/boardCost";
import { visibleItemIdsForBoard } from "@/lib/serverVisibility";

export type BoardCostReport = BoardCostSummary & {
  hoursPerDay: number;
  /** People who logged hours on this board but have no rate set, so their
   *  work is currently costing zero. Named rather than counted: the fix is
   *  to go and set that person's rate. */
  missingRateNames: string[];
  /** True when nothing on the board has a budget or an actual — the report
   *  then has nothing to show and says so instead of a wall of zeros. */
  empty: boolean;
  /** Summary rows carrying a 直接費用 budget, which the leaf rule leaves out
   *  of BAC. Reported rather than dropped in silence: somebody typed that
   *  number and is entitled to know it is not being counted. */
  ignoredParentBudgets: string[];
};

/**
 * 成本與 EVM for one board.
 *
 * Budgets are counted on leaf tasks only, the same rule the critical path
 * uses: a Summary's budget and its children's are liable to be the same
 * money written twice.
 *
 * Actuals are counted everywhere. Hours booked to a summary row exist once
 * and were really worked; dropping them would understate what the project
 * has cost, which is the worse of the two errors.
 */
export async function getBoardCostReport(boardId: string): Promise<BoardCostReport> {
  const session = await requireSession();
  await requireBoardAccess(boardId, session);

  const [board, settings, holidayRows] = await Promise.all([
    prisma.board.findUnique({
      where: { id: boardId },
      select: {
        ganttStartColumnId: true,
        ganttDurationColumnId: true,
        ganttDurationMode: true,
        progressColumnId: true,
        reportStatusColumnId: true,
        reportDoneOptionIds: true,
      },
    }),
    getSystemSettings(),
    listHolidays(),
  ]);
  const hoursPerDay = settings.hoursPerDay;
  const holidays = toHolidaySet(holidayRows);

  const [items, users, timeEntries] = await Promise.all([
    prisma.item.findMany({
      where: { boardId, deletedAt: null },
      select: {
        id: true,
        name: true,
        parentId: true,
        budgetCost: true,
        actualCost: true,
        baselineStart: true,
        baselineEnd: true,
        cellValues: true,
        assignments: { select: { userId: true, allocationPct: true } },
      },
    }),
    prisma.user.findMany({ select: { id: true, name: true, hourlyRate: true } }),
    prisma.timeEntry.findMany({
      where: { item: { boardId, deletedAt: null } },
      select: { itemId: true, userId: true, hours: true },
    }),
  ]);

  // 統計只算看得到的:一個私人工作項不該從它的名字、也不該從一筆對不上的
  // 金額被推敲出來。
  const visibleIds = await visibleItemIdsForBoard(boardId, session);

  const rateByUser = new Map(users.map((u) => [u.id, u.hourlyRate ? Number(u.hourlyRate) : 0]));
  const nameByUser = new Map(users.map((u) => [u.id, u.name]));
  const parentIds = new Set(items.map((i) => i.parentId).filter(Boolean));

  // itemId -> userId -> hours
  const hoursByItem = new Map<string, Map<string, number>>();
  const missingRateIds = new Set<string>();
  for (const entry of timeEntries) {
    const perUser = hoursByItem.get(entry.itemId) ?? new Map<string, number>();
    perUser.set(entry.userId, (perUser.get(entry.userId) ?? 0) + Number(entry.hours));
    hoursByItem.set(entry.itemId, perUser);
    if (!rateByUser.get(entry.userId)) missingRateIds.add(entry.userId);
  }

  const doneIds = new Set(board?.reportDoneOptionIds ?? []);
  const progressColumnId = board?.progressColumnId ?? null;
  const statusColumnId = board?.reportStatusColumnId ?? null;

  const inputs: CostItemInput[] = [];
  const ignoredParentBudgets: string[] = [];
  for (const item of items) {
    if (!visibleIds.has(item.id)) continue;
    const isLeaf = !parentIds.has(item.id);
    if (!isLeaf && item.budgetCost) ignoredParentBudgets.push(item.name);

    const range =
      board?.ganttStartColumnId && board.ganttDurationColumnId
        ? getItemDateRange(
            item,
            board.ganttStartColumnId,
            board.ganttDurationColumnId,
            board.ganttDurationMode,
            holidays
          )
        : null;
    const workingDays = range
      ? (countDaysInRange(range.start, range.end, board!.ganttDurationMode, holidays) ?? 0)
      : 0;

    const plannedLabour = item.assignments.reduce(
      (sum, a) => sum + labourCost(workingDays, a.allocationPct, rateByUser.get(a.userId) ?? 0, hoursPerDay),
      0
    );
    const actualLabour = [...(hoursByItem.get(item.id) ?? new Map())].reduce(
      (sum, [userId, hours]) => sum + hours * (rateByUser.get(userId) ?? 0),
      0
    );

    // % Done where the board scores it; otherwise a task is done or it is not.
    const progressValue = progressColumnId
      ? item.cellValues.find((cv) => cv.columnId === progressColumnId)?.value
      : undefined;
    const statusValue = statusColumnId
      ? item.cellValues.find((cv) => cv.columnId === statusColumnId)?.value
      : undefined;
    const fractionDone =
      typeof progressValue === "number"
        ? Math.min(1, Math.max(0, progressValue / 100))
        : typeof statusValue === "string" && doneIds.has(statusValue)
          ? 1
          : 0;

    // A summary contributes its actuals and nothing else: no budget, and
    // therefore no earned value to compare them against.
    if (!isLeaf && actualLabour === 0 && !item.actualCost) continue;

    inputs.push({
      id: item.id,
      name: item.name,
      plannedLabour: isLeaf ? plannedLabour : 0,
      plannedDirect: isLeaf ? (item.budgetCost ?? 0) : 0,
      actualLabour,
      actualDirect: item.actualCost ?? 0,
      fractionDone: isLeaf ? fractionDone : 0,
      // The baseline is the plan PV should be read against; without one,
      // today's schedule is the only plan there is.
      plannedStart: item.baselineStart ? new Date(item.baselineStart) : (range?.start ?? null),
      plannedEnd: item.baselineEnd ? new Date(item.baselineEnd) : (range?.end ?? null),
    });
  }

  const summary = computeBoardCost(inputs, new Date(new Date().toISOString().slice(0, 10)));
  return {
    ...summary,
    hoursPerDay,
    missingRateNames: [...missingRateIds].map((id) => nameByUser.get(id) ?? id),
    ignoredParentBudgets,
    empty: summary.planned.total === 0 && summary.actual.total === 0,
  };
}
