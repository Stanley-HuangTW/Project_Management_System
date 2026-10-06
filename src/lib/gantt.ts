import type { GanttDurationMode } from "@prisma/client";
import type { ItemData } from "@/types/board";
import { getPersonIds } from "@/types/column";
import { addBusinessDays, isNonWorkingDay } from "@/lib/workday";

export type DateRange = { start: Date; end: Date };

/**
 * Reads the item's start-date and duration-day cell values and turns them
 * into a concrete [start, end] range. Returns null if either value is
 * missing — such items are not plotted on the Gantt chart. A 0-day duration
 * (a milestone with no length of its own) still counts as a valid range,
 * occupying just its start date. In "BUSINESS" mode the end date skips
 * weekends and the given holidays instead of counting plain calendar days.
 */
export function getItemDateRange(
  item: Pick<ItemData, "cellValues">,
  startColumnId: string,
  durationColumnId: string,
  mode: GanttDurationMode = "CALENDAR",
  holidays: Set<string> = new Set()
): DateRange | null {
  const startValue = item.cellValues.find((cv) => cv.columnId === startColumnId)?.value;
  const durationValue = item.cellValues.find((cv) => cv.columnId === durationColumnId)?.value;

  if (typeof startValue !== "string" || typeof durationValue !== "number") return null;
  if (durationValue < 0) return null;

  const start = new Date(startValue);
  if (Number.isNaN(start.getTime())) return null;

  if (mode === "BUSINESS") {
    return { start, end: addBusinessDays(start, Math.max(durationValue, 1), holidays) };
  }

  const end = new Date(start);
  end.setDate(end.getDate() + Math.max(durationValue - 1, 0));

  return { start, end };
}

/** The column that can pin an item's schedule to a rule of its own: a Pred
 *  (its dates follow that predecessor). */
/**
 * 一根長條在時間軸上佔哪幾欄。「工作天」模式下週末與假日不佔寬度(時間軸直接跳過),起訖日
 * 若剛好落在那一天,查表會落空——以前一律退回第 0 欄,長條就被畫到最左邊。這裡改成:開始往後靠到
 * 下一個工作日、結束往前靠到上一個工作日(跟相依箭頭 indexForDate 同一套規則);整根都落在
 * 非工作日(例如 0 天的里程碑排在假日)就畫在下一個工作日那一格。
 */
export function barIndexRange(
  days: Date[],
  range: DateRange,
  dayIndexByIso: Map<string, number>
): { startIndex: number; endIndex: number } {
  if (days.length === 0) return { startIndex: 0, endIndex: 0 };
  const startIso = toIsoDate(range.start);
  const endIso = toIsoDate(range.end);

  // 第一個 >= iso 的欄位(沒有就是最後一欄)。
  const firstOnOrAfter = (iso: string) => {
    let lo = 0;
    let hi = days.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (toIsoDate(days[mid]) >= iso) hi = mid;
      else lo = mid + 1;
    }
    return lo;
  };
  // 最後一個 <= iso 的欄位(沒有就是第 0 欄)。
  const lastOnOrBefore = (iso: string) => {
    let lo = 0;
    let hi = days.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (toIsoDate(days[mid]) <= iso) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  };

  const startIndex = dayIndexByIso.get(startIso) ?? firstOnOrAfter(startIso);
  const endIndex = Math.max(dayIndexByIso.get(endIso) ?? lastOnOrBefore(endIso), startIndex);
  return { startIndex, endIndex };
}

export type OwnScheduleRuleColumns = {
  predColumnId?: string | null;
};

/**
 * Whether this item's schedule is driven by a Pred it owns, rather than being
 * whatever its children happen to span. A summary with a Pred is the authority
 * on its dates; its children are expected to fit inside that window.
 *
 * A manual start (start(set)) deliberately does NOT count. On an "always
 * computed" board every item carries one — new rows get today's date, and a
 * task keeps the start/duration it had before it gained children — so treating
 * it as a rule meant no summary on such a board ever followed its children: the
 * bar stayed at whatever the parent was last planned as.
 */
export function hasOwnScheduleRule(
  item: Pick<ItemData, "cellValues">,
  columns?: OwnScheduleRuleColumns
): boolean {
  if (!columns) return false;
  if (!columns.predColumnId) return false;
  const value = item.cellValues.find((cv) => cv.columnId === columns.predColumnId)?.value;
  return typeof value === "string" && value.trim() !== "";
}

/**
 * Like getItemDateRange, but for an item with children it rolls up to the
 * earliest child start and latest child end (recursively) instead of
 * reading its own Start/Days cells — a "Summary" row's range is whatever
 * its subtree currently spans, computed fresh each time (never stored).
 * Leaf items (no children) behave exactly like getItemDateRange.
 *
 * Exception: pass `ownRuleColumns` and a parent that has a schedule rule of
 * its own (see hasOwnScheduleRule) keeps its own Start/Days instead of being
 * redefined by its subtree — otherwise adding a child to a Pred-driven task
 * would silently throw its computed dates away.
 */
export function computeRolledUpDateRange(
  item: Pick<ItemData, "id" | "cellValues">,
  allItems: Pick<ItemData, "id" | "parentId" | "cellValues">[],
  startColumnId: string,
  durationColumnId: string,
  mode: GanttDurationMode = "CALENDAR",
  holidays: Set<string> = new Set(),
  ownRuleColumns?: OwnScheduleRuleColumns
): DateRange | null {
  const children = allItems.filter((i) => i.parentId === item.id);
  if (children.length === 0) {
    return getItemDateRange(item, startColumnId, durationColumnId, mode, holidays);
  }

  if (hasOwnScheduleRule(item, ownRuleColumns)) {
    const own = getItemDateRange(item, startColumnId, durationColumnId, mode, holidays);
    if (own) return own;
  }

  let min: Date | null = null;
  let max: Date | null = null;
  for (const child of children) {
    const childRange = computeRolledUpDateRange(
      child,
      allItems,
      startColumnId,
      durationColumnId,
      mode,
      holidays,
      ownRuleColumns
    );
    if (!childRange) continue;
    if (!min || childRange.start < min) min = childRange.start;
    if (!max || childRange.end > max) max = childRange.end;
  }
  return min && max ? { start: min, end: max } : null;
}

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** 沒有人員分配、只掛在負責人欄位的人,預設算幾 % 的工作量(系統設定可調)。 */
export const DEFAULT_OWNER_ALLOCATION_PCT = 2;

/**
 * For every item with a resolvable date range, spreads each assignee's load
 * across every day in that range, accumulated per user. A real 人員分配
 * (Assignment, with its allocationPct) counts at its own percentage. A name
 * in a PERSON column (負責人 …) with no Assignment of its own says who is
 * responsible but not how much time it takes, so it counts only at
 * `owner.defaultPct` (small — 0 turns it off) instead of a full day. Used to
 * detect days where a person is assigned over 100%.
 */
export function computeDailyLoadByUser(
  items: ItemData[],
  startColumnId: string,
  durationColumnId: string,
  mode: GanttDurationMode = "CALENDAR",
  holidays: Set<string> = new Set(),
  owner: { personColumnIds: string[]; defaultPct: number } = { personColumnIds: [], defaultPct: 0 }
): Map<string, Map<string, number>> {
  const loadByUser = new Map<string, Map<string, number>>();

  function addLoad(userId: string, range: DateRange, pct: number) {
    let dayMap = loadByUser.get(userId);
    if (!dayMap) {
      dayMap = new Map();
      loadByUser.set(userId, dayMap);
    }
    const cursor = new Date(range.start);
    while (cursor <= range.end) {
      if (mode !== "BUSINESS" || !isNonWorkingDay(cursor, holidays)) {
        const key = toIsoDate(cursor);
        dayMap.set(key, (dayMap.get(key) ?? 0) + pct);
      }
      cursor.setDate(cursor.getDate() + 1);
    }
  }

  for (const item of items) {
    const range = getItemDateRange(item, startColumnId, durationColumnId, mode, holidays);
    if (!range) continue;

    const covered = new Set<string>();
    for (const assignment of item.assignments) {
      addLoad(assignment.userId, range, assignment.allocationPct);
      covered.add(assignment.userId);
    }

    if (owner.defaultPct > 0) {
      const ownerIds = item.cellValues
        .filter((cv) => owner.personColumnIds.includes(cv.columnId))
        .flatMap((cv) => getPersonIds(cv.value));
      for (const userId of new Set(ownerIds)) {
        if (!covered.has(userId)) addLoad(userId, range, owner.defaultPct);
      }
    }
  }

  return loadByUser;
}

/**
 * When a board computes Start/Days/Finish from two manual columns, a user
 * who clicks one of those locked cells has a concrete answer to "then what
 * do I change?" — name the two columns rather than leaving the generic
 * "it's calculated" message. Undefined when the board isn't in that mode.
 */
export function manualScheduleHint(
  columns: { id: string; name: string }[],
  manualStartColumnId?: string | null,
  manualDurationColumnId?: string | null
): string | undefined {
  if (!manualStartColumnId || !manualDurationColumnId) return undefined;
  const start = columns.find((c) => c.id === manualStartColumnId)?.name;
  const duration = columns.find((c) => c.id === manualDurationColumnId)?.name;
  if (!start || !duration) return undefined;
  return `此日期/天數由「${start}」與「${duration}」加上前置依賴自動計算,請改這兩個欄位`;
}
