import { prisma } from "@/lib/prisma";
import type { SessionPayload } from "@/lib/jwt";
import { getItemDateRange } from "@/lib/gantt";
import { countDaysInRange } from "@/lib/workday";
import { listHolidays, toHolidaySet } from "@/lib/holidays";
import { labourCost } from "@/lib/cost";
import type { CostItemInput } from "@/lib/boardCost";
import { visibleItemIdsForBoard } from "@/lib/serverVisibility";

export type GatheredCosts = {
  inputs: CostItemInput[];
  hoursPerDay: number;
  /** People who logged hours but have no rate set, so their work is currently
   *  costing zero. Named rather than counted: the fix is to go and set that
   *  person's rate. */
  missingRateNames: string[];
  /** Summary rows carrying a 直接費用 budget, which the leaf rule leaves out
   *  of BAC. Reported rather than dropped in silence: somebody typed that
   *  number and is entitled to know it is not being counted. */
  ignoredParentBudgets: string[];
};

/**
 * Every leaf task's money, for one board or for all the boards of a 專案群組.
 *
 * Budgets are counted on leaf tasks only, the same rule the critical path
 * uses: a Summary's budget and its children's are liable to be the same money
 * written twice.
 *
 * Actuals are counted everywhere. Hours booked to a summary row exist once and
 * were really worked; dropping them would understate what the project has
 * cost, which is the worse of the two errors.
 *
 * Several boards go in one flat list because that is what makes a group's
 * CPI mean anything: one BAC, one EV, one AC, drawn from the same per-task
 * budgets. Anything the session may not see is left out before the maths, not
 * after — 統計只算看得到的.
 */
export async function gatherCostInputs(
  boardIds: string[],
  session: SessionPayload,
  hoursPerDay: number
): Promise<GatheredCosts> {
  const holidays = toHolidaySet(await listHolidays());

  const [boards, users] = await Promise.all([
    prisma.board.findMany({
      where: { id: { in: boardIds } },
      select: {
        id: true,
        ganttStartColumnId: true,
        ganttDurationColumnId: true,
        ganttDurationMode: true,
        progressColumnId: true,
        reportStatusColumnId: true,
        reportDoneOptionIds: true,
      },
    }),
    prisma.user.findMany({ select: { id: true, name: true, hourlyRate: true } }),
  ]);

  const rateByUser = new Map(users.map((u) => [u.id, u.hourlyRate ? Number(u.hourlyRate) : 0]));
  const nameByUser = new Map(users.map((u) => [u.id, u.name]));

  const inputs: CostItemInput[] = [];
  const ignoredParentBudgets: string[] = [];
  const missingRateIds = new Set<string>();

  for (const board of boards) {
    const [items, timeEntries, visibleIds] = await Promise.all([
      prisma.item.findMany({
        where: { boardId: board.id, deletedAt: null },
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
      prisma.timeEntry.findMany({
        // 只算核准過的。待審的工時是一個主張,不是一筆成本——讓它進 AC,
        // CPI 就會隨著誰還沒按核准而上下跳。
        where: { item: { boardId: board.id, deletedAt: null }, status: "APPROVED" },
        select: { itemId: true, userId: true, hours: true },
      }),
      visibleItemIdsForBoard(board.id, session),
    ]);

    const parentIds = new Set(items.map((i) => i.parentId).filter(Boolean));

    // itemId -> userId -> hours
    const hoursByItem = new Map<string, Map<string, number>>();
    for (const entry of timeEntries) {
      const perUser = hoursByItem.get(entry.itemId) ?? new Map<string, number>();
      perUser.set(entry.userId, (perUser.get(entry.userId) ?? 0) + Number(entry.hours));
      hoursByItem.set(entry.itemId, perUser);
      if (!rateByUser.get(entry.userId)) missingRateIds.add(entry.userId);
    }

    const doneIds = new Set(board.reportDoneOptionIds ?? []);

    for (const item of items) {
      if (!visibleIds.has(item.id)) continue;
      const isLeaf = !parentIds.has(item.id);
      if (!isLeaf && item.budgetCost) ignoredParentBudgets.push(item.name);

      const range =
        board.ganttStartColumnId && board.ganttDurationColumnId
          ? getItemDateRange(
              item,
              board.ganttStartColumnId,
              board.ganttDurationColumnId,
              board.ganttDurationMode,
              holidays
            )
          : null;
      const workingDays = range
        ? (countDaysInRange(range.start, range.end, board.ganttDurationMode, holidays) ?? 0)
        : 0;

      const plannedLabour = item.assignments.reduce(
        (sum, a) => sum + labourCost(workingDays, a.allocationPct, rateByUser.get(a.userId) ?? 0, hoursPerDay),
        0
      );
      const actualLabour = [...(hoursByItem.get(item.id) ?? new Map<string, number>())].reduce(
        (sum, [userId, hours]) => sum + hours * (rateByUser.get(userId) ?? 0),
        0
      );

      // % Done where the board scores it; otherwise a task is done or it is not.
      const progressValue = board.progressColumnId
        ? item.cellValues.find((cv) => cv.columnId === board.progressColumnId)?.value
        : undefined;
      const statusValue = board.reportStatusColumnId
        ? item.cellValues.find((cv) => cv.columnId === board.reportStatusColumnId)?.value
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
  }

  return {
    inputs,
    hoursPerDay,
    missingRateNames: [...missingRateIds].map((id) => nameByUser.get(id) ?? id),
    ignoredParentBudgets,
  };
}
