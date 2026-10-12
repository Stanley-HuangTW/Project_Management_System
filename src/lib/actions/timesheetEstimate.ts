"use server";

import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { accessibleBoardWhere } from "@/lib/boardAccess";
import { boardWithDataArgs } from "@/types/board";
import { getItemDateRange } from "@/lib/gantt";
import { listHolidays, toHolidaySet } from "@/lib/holidays";
import { weekRangeOf } from "@/lib/weeklyReport";
import { isValidIsoDate, weekDays } from "@/lib/timesheet";
import {
  isWorkday,
  itemHoursByDay,
  labourHoursByDay,
  type EstimateProject,
  type EstimateWeek,
} from "@/lib/timesheetEstimate";
import { getSystemSettings } from "./systemSettings";

/**
 * 我這一週的工時預估(人力表預估 + 工作項預估),給「我的工時」跟實際登記的工時並排看。
 *
 * 只看自己的,而且只算看得到的看板。實際工時不在這裡——畫面已經有這一週的登記,
 * 直接用它,修改工時後對照表才會立刻跟著變,不必再來回一趟伺服器。
 */
export async function getMyEstimates(weekStart: string): Promise<EstimateWeek | { error: string }> {
  const session = await requireSession();
  if (!isValidIsoDate(weekStart)) return { error: "日期格式不正確" };
  const range = weekRangeOf(weekStart);
  const days = weekDays(range.weekStart);
  const boardWhere = accessibleBoardWhere(session);

  const [settings, holidayRows, slots, boards] = await Promise.all([
    getSystemSettings(),
    listHolidays(),
    // 人力表:指到我的名額,以及這一週涵蓋的月份的投入。
    prisma.labourSlot.findMany({
      where: { userId: session.userId, board: boardWhere },
      select: {
        boardId: true,
        label: true,
        order: true,
        board: { select: { name: true } },
        months: { where: { month: { in: [...new Set(days.map((d) => d.slice(0, 7)))] } }, select: { month: true, fte: true } },
      },
      orderBy: { order: "asc" },
    }),
    // 工作項:指派給我的。整份看板資料才算得出工作項的起訖,所以只載入有指派我的看板。
    prisma.board.findMany({
      where: {
        AND: [boardWhere, { items: { some: { deletedAt: null, assignments: { some: { userId: session.userId } } } } }],
      },
      ...boardWithDataArgs,
    }),
  ]);
  const holidays = toHolidaySet(holidayRows);
  const workdays = new Set(days.filter((d) => isWorkday(d, holidays)));
  const hoursPerDay = settings.hoursPerDay;

  const projects = new Map<string, EstimateProject>();
  const projectOf = (boardId: string, boardName: string) => {
    let p = projects.get(boardId);
    if (!p) {
      p = { boardId, boardName, slotLabels: [], labour: {}, items: [] };
      projects.set(boardId, p);
    }
    return p;
  };

  // 同一個專案有好幾個名額(同一個人兼兩個職能)時,每月的投入先加總再攤。
  const fteByBoard = new Map<string, Record<string, number>>();
  for (const slot of slots) {
    const p = projectOf(slot.boardId, slot.board.name);
    if (!p.slotLabels.includes(slot.label)) p.slotLabels.push(slot.label);
    const fte = fteByBoard.get(slot.boardId) ?? {};
    for (const m of slot.months) fte[m.month] = (fte[m.month] ?? 0) + Number(m.fte);
    fteByBoard.set(slot.boardId, fte);
  }
  for (const [boardId, fte] of fteByBoard) {
    projects.get(boardId)!.labour = labourHoursByDay(fte, days, workdays, hoursPerDay);
  }

  for (const board of boards) {
    if (!board.ganttStartColumnId || !board.ganttDurationColumnId) continue;
    // 父項的起訖是子項滾上來的,配置比例也多半是同一個人寫兩次——只算葉節點,跟成本報表一樣。
    const parentIds = new Set(board.items.map((i) => i.parentId).filter((id): id is string => !!id));
    for (const item of board.items) {
      if (parentIds.has(item.id)) continue;
      const assignment = item.assignments.find((a) => a.userId === session.userId);
      if (!assignment) continue;
      const itemRange = getItemDateRange(
        item,
        board.ganttStartColumnId,
        board.ganttDurationColumnId,
        board.ganttDurationMode,
        holidays
      );
      if (!itemRange) continue;
      const startDate = itemRange.start.toISOString().slice(0, 10);
      const endDate = itemRange.end.toISOString().slice(0, 10);
      const hours = itemHoursByDay(assignment.allocationPct, startDate, endDate, days, workdays, hoursPerDay);
      if (Object.keys(hours).length === 0) continue;
      projectOf(board.id, board.name).items.push({
        itemId: item.id,
        itemName: item.name,
        allocationPct: assignment.allocationPct,
        startDate,
        endDate,
        hours,
      });
    }
  }

  return {
    weekStart: range.weekStart,
    hoursPerDay,
    workdays: days.filter((d) => workdays.has(d)),
    projects: [...projects.values()].filter((p) => Object.keys(p.labour).length > 0 || p.items.length > 0),
  };
}
