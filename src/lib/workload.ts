import type { BoardWithData, ItemData } from "@/types/board";
import { getPersonIds } from "@/types/column";
import { getItemDateRange, computeDailyLoadByUser, DEFAULT_OWNER_ALLOCATION_PCT } from "@/lib/gantt";
import { groupByBoardAndGroup } from "@/lib/boardGrouping";
import { computeWbsCodes, compareWbsCodes } from "@/lib/wbs";

export type WorkloadThresholdSettings = {
  greenMax: number;
  yellowMax: number;
  greenColor: string;
  yellowColor: string;
  redColor: string;
};

export function colorForPct(pct: number, t: WorkloadThresholdSettings): string {
  if (pct < t.greenMax) return t.greenColor;
  if (pct < t.yellowMax) return t.yellowColor;
  return t.redColor;
}

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

export type MemberTask = {
  boardId: string;
  boardName: string;
  groupId: string;
  groupName: string;
  itemId: string;
  itemName: string;
  /** 這個項目在它自己分組樹裡的位置("1"、"1.1"、"1.1.2"...),給清單排序
   *  跟顯示用 —— 跟儀表板逾期/即將到期清單同一套。 */
  wbsCode: string;
  allocationPct: number;
  startDate: Date | null;
  endDate: Date | null;
};

/** 一個人的任務照「看板 → 分組」收起來 —— 跟儀表板的逾期清單同一套。 */
export function groupTasksByBoardAndGroup(tasks: MemberTask[]) {
  return groupByBoardAndGroup(tasks);
}

/**
 * Per-user list of assigned tasks: a real 人員分配 counts at its own allocation
 * %. A name in a PERSON column (負責人 …) with no 人員分配 counts only at
 * `ownerDefaultPct` (system setting, small, 0 = not at all) — it says who is
 * responsible, not that they spend the whole day on it.
 */
export function computeMemberTaskBreakdown(
  boards: BoardWithData[],
  userIds: string[],
  holidays: Set<string> = new Set(),
  ownerDefaultPct: number = DEFAULT_OWNER_ALLOCATION_PCT
): Map<string, MemberTask[]> {
  const idSet = new Set(userIds);
  const byUser = new Map<string, MemberTask[]>();

  function addTask(
    userId: string,
    board: BoardWithData,
    item: ItemData,
    wbs: Map<string, string>,
    allocationPct: number,
    hasRange: boolean
  ) {
    const group = board.groups.find((g) => g.id === item.groupId);
    const range = hasRange
      ? getItemDateRange(
          item,
          board.ganttStartColumnId!,
          board.ganttDurationColumnId!,
          board.ganttDurationMode,
          holidays
        )
      : null;
    const list = byUser.get(userId) ?? [];
    list.push({
      boardId: board.id,
      boardName: board.name,
      groupId: item.groupId,
      groupName: group?.name ?? "",
      itemId: item.id,
      itemName: item.name,
      wbsCode: wbs.get(item.id) ?? "",
      allocationPct,
      startDate: range?.start ?? null,
      endDate: range?.end ?? null,
    });
    byUser.set(userId, list);
  }

  for (const board of boards) {
    const hasRange = !!(board.ganttStartColumnId && board.ganttDurationColumnId);
    const personColumnIds = board.columns.filter((c) => c.type === "PERSON").map((c) => c.id);
    // WBS 是項目在它自己分組樹裡的位置,一個分組算一次。
    const wbs = new Map<string, string>();
    for (const group of board.groups) {
      const groupItems = board.items.filter((i) => i.groupId === group.id);
      for (const [id, code] of computeWbsCodes(groupItems)) wbs.set(id, code);
    }

    for (const item of board.items) {
      const covered = new Set<string>();
      for (const assignment of item.assignments) {
        covered.add(assignment.userId);
        if (!idSet.has(assignment.userId)) continue;
        addTask(assignment.userId, board, item, wbs, assignment.allocationPct, hasRange);
      }

      if (ownerDefaultPct > 0) {
        const ownerIds = item.cellValues
          .filter((cv) => personColumnIds.includes(cv.columnId))
          .flatMap((cv) => getPersonIds(cv.value));
        for (const userId of new Set(ownerIds)) {
          if (!idSet.has(userId) || covered.has(userId)) continue;
          addTask(userId, board, item, wbs, ownerDefaultPct, hasRange);
        }
      }
    }
  }

  // 依看板、分組、WBS 代號排序,讓成員工作量明細跟看板本身的階層順序一致。
  for (const list of byUser.values()) {
    list.sort((a, b) => {
      if (a.boardId !== b.boardId) return a.boardName.localeCompare(b.boardName);
      if (a.groupId !== b.groupId) return a.groupName.localeCompare(b.groupName);
      return compareWbsCodes(a.wbsCode, b.wbsCode);
    });
  }

  return byUser;
}

/** Merges each board's per-day load-by-user map into one cross-board map. */
export function computeCrossBoardDailyLoad(
  boards: BoardWithData[],
  userIds: string[],
  holidays: Set<string> = new Set(),
  ownerDefaultPct: number = DEFAULT_OWNER_ALLOCATION_PCT
): Map<string, Map<string, number>> {
  const idSet = new Set(userIds);
  const merged = new Map<string, Map<string, number>>();

  for (const board of boards) {
    if (!board.ganttStartColumnId || !board.ganttDurationColumnId) continue;
    const dailyLoad = computeDailyLoadByUser(
      board.items,
      board.ganttStartColumnId,
      board.ganttDurationColumnId,
      board.ganttDurationMode,
      holidays,
      {
        personColumnIds: board.columns.filter((c) => c.type === "PERSON").map((c) => c.id),
        defaultPct: ownerDefaultPct,
      }
    );
    for (const [userId, dayMap] of dailyLoad) {
      if (!idSet.has(userId)) continue;
      const target = merged.get(userId) ?? new Map<string, number>();
      for (const [date, pct] of dayMap) {
        target.set(date, (target.get(date) ?? 0) + pct);
      }
      merged.set(userId, target);
    }
  }

  return merged;
}

/** Earliest start / latest end across every item with a resolvable Gantt date range. */
function computeOverallDateRange(
  boards: BoardWithData[],
  holidays: Set<string> = new Set()
): { min: Date; max: Date } {
  let min: Date | null = null;
  let max: Date | null = null;

  for (const board of boards) {
    if (!board.ganttStartColumnId || !board.ganttDurationColumnId) continue;
    for (const item of board.items) {
      const range = getItemDateRange(
        item,
        board.ganttStartColumnId,
        board.ganttDurationColumnId,
        board.ganttDurationMode,
        holidays
      );
      if (!range) continue;
      if (!min || range.start < min) min = range.start;
      if (!max || range.end > max) max = range.end;
    }
  }

  const today = new Date(new Date().toISOString().slice(0, 10));
  if (!min || !max) return { min: today, max: today };
  return { min, max };
}

export type WeekColumn = { start: Date; label: string; monthLabel: string; isMonthStart: boolean };

function mondayOf(date: Date): Date {
  const day = date.getUTCDay(); // 0 = Sunday
  const offset = day === 0 ? -6 : 1 - day;
  return addDays(date, offset);
}

/**
 * Monday-start week columns spanning every item's date range across the
 * given boards (capped at 60 weeks, ~14 months), each tagged with its
 * calendar month for grouping. Falls back to the current week if no item
 * has a resolvable date range.
 */
export function computeWeekColumns(
  boards: BoardWithData[],
  holidays: Set<string> = new Set()
): WeekColumn[] {
  const { min, max } = computeOverallDateRange(boards, holidays);

  const weeks: WeekColumn[] = [];
  let cursor = mondayOf(min);
  let lastMonth = -1;

  while (cursor <= max && weeks.length < 60) {
    const month = cursor.getUTCMonth();
    weeks.push({
      start: new Date(cursor),
      label: `${cursor.getUTCMonth() + 1}/${cursor.getUTCDate()}`,
      monthLabel: `${cursor.getUTCFullYear()}/${cursor.getUTCMonth() + 1}`,
      isMonthStart: month !== lastMonth,
    });
    lastMonth = month;
    cursor = addDays(cursor, 7);
  }

  return weeks;
}

/** Per-user average allocation % for each week column, using the same cross-board daily load. */
export function computeMemberWeeklyLoad(
  boards: BoardWithData[],
  userIds: string[],
  weeks: WeekColumn[],
  holidays: Set<string> = new Set(),
  ownerDefaultPct: number = DEFAULT_OWNER_ALLOCATION_PCT
): Map<string, number[]> {
  const dailyLoad = computeCrossBoardDailyLoad(boards, userIds, holidays, ownerDefaultPct);

  const result = new Map<string, number[]>();
  for (const userId of userIds) {
    const dayMap = dailyLoad.get(userId);
    const values = weeks.map((week) => {
      let sum = 0;
      for (let i = 0; i < 7; i++) {
        sum += dayMap?.get(toIsoDate(addDays(week.start, i))) ?? 0;
      }
      return Math.round(sum / 7);
    });
    result.set(userId, values);
  }
  return result;
}

/** Index of the week column containing the given date (clamped to the first column). */
export function weekIndexForDate(date: Date, weeks: WeekColumn[]): number {
  for (let i = weeks.length - 1; i >= 0; i--) {
    if (date >= weeks[i].start) return i;
  }
  return 0;
}
