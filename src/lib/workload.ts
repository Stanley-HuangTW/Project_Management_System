import type { BoardWithData, ItemData } from "@/types/board";
import { getPersonIds } from "@/types/column";
import { getItemDateRange, computeDailyLoadByUser } from "@/lib/gantt";

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
  allocationPct: number;
  startDate: Date | null;
  endDate: Date | null;
};

/**
 * Per-user list of assigned tasks — a Gantt Assignment (which carries a real
 * allocation %), or a PERSON-column value (負責人/Resource) naming them, the
 * same two mechanisms isItemAssignedToUser treats as equivalent everywhere
 * else. A PERSON-column match has no allocation % of its own, so it's shown
 * as fully allocated (100%) unless a Gantt Assignment already covers it.
 */
export type TaskGroup = { groupId: string; groupName: string; tasks: MemberTask[] };
export type TaskBoard = { boardId: string; boardName: string; groups: TaskGroup[] };

/**
 * 一個人的任務照「看板 → 分組」收起來。攤平成一長串的時候,看到的是十幾條
 * 名稱,看不出哪幾條是同一個專案的同一個階段 —— 而那正是要判斷「他這段時間
 * 到底在忙哪裡」需要的資訊。
 *
 * 順序沿用 tasks 本身的順序(也就是看板與項目原本的排序),不另外排,這樣
 * 展開後的順序跟看板上看到的一致。
 */
export function groupTasksByBoardAndGroup(tasks: MemberTask[]): TaskBoard[] {
  const boards: TaskBoard[] = [];
  const boardIndex = new Map<string, TaskBoard>();
  const groupIndex = new Map<string, TaskGroup>();

  for (const task of tasks) {
    let board = boardIndex.get(task.boardId);
    if (!board) {
      board = { boardId: task.boardId, boardName: task.boardName, groups: [] };
      boardIndex.set(task.boardId, board);
      boards.push(board);
    }
    const key = `${task.boardId}:${task.groupId}`;
    let group = groupIndex.get(key);
    if (!group) {
      group = { groupId: task.groupId, groupName: task.groupName, tasks: [] };
      groupIndex.set(key, group);
      board.groups.push(group);
    }
    group.tasks.push(task);
  }

  return boards;
}

export function computeMemberTaskBreakdown(
  boards: BoardWithData[],
  userIds: string[],
  holidays: Set<string> = new Set()
): Map<string, MemberTask[]> {
  const idSet = new Set(userIds);
  const byUser = new Map<string, MemberTask[]>();

  function addTask(userId: string, board: BoardWithData, item: ItemData, allocationPct: number, hasRange: boolean) {
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
      allocationPct,
      startDate: range?.start ?? null,
      endDate: range?.end ?? null,
    });
    byUser.set(userId, list);
  }

  for (const board of boards) {
    const hasRange = !!(board.ganttStartColumnId && board.ganttDurationColumnId);
    const personColumnIds = board.columns.filter((c) => c.type === "PERSON").map((c) => c.id);

    for (const item of board.items) {
      const coveredByAssignment = new Set<string>();
      for (const assignment of item.assignments) {
        if (!idSet.has(assignment.userId)) continue;
        addTask(assignment.userId, board, item, assignment.allocationPct, hasRange);
        coveredByAssignment.add(assignment.userId);
      }

      const personIds = item.cellValues
        .filter((cv) => personColumnIds.includes(cv.columnId))
        .flatMap((cv) => getPersonIds(cv.value));
      for (const userId of personIds) {
        if (!idSet.has(userId) || coveredByAssignment.has(userId)) continue;
        addTask(userId, board, item, 100, hasRange);
      }
    }
  }

  return byUser;
}

/** Merges each board's per-day load-by-user map into one cross-board map. */
export function computeCrossBoardDailyLoad(
  boards: BoardWithData[],
  userIds: string[],
  holidays: Set<string> = new Set()
): Map<string, Map<string, number>> {
  const idSet = new Set(userIds);
  const merged = new Map<string, Map<string, number>>();

  for (const board of boards) {
    if (!board.ganttStartColumnId || !board.ganttDurationColumnId) continue;
    const personColumnIds = board.columns.filter((c) => c.type === "PERSON").map((c) => c.id);
    const dailyLoad = computeDailyLoadByUser(
      board.items,
      board.ganttStartColumnId,
      board.ganttDurationColumnId,
      personColumnIds,
      board.ganttDurationMode,
      holidays
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
  holidays: Set<string> = new Set()
): Map<string, number[]> {
  const dailyLoad = computeCrossBoardDailyLoad(boards, userIds, holidays);

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
