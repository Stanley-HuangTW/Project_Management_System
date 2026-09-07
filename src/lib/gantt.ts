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

/** The columns that can pin an item's schedule to a rule of its own: a Pred
 *  (its dates follow that predecessor) or a manual start date. */
export type OwnScheduleRuleColumns = {
  predColumnId?: string | null;
  manualStartColumnId?: string | null;
};

/**
 * Whether this item's schedule is driven by a rule it owns — a Pred, or an
 * explicitly set manual start date — rather than being whatever its children
 * happen to span. A summary with a rule of its own is the authority on its
 * dates; its children are expected to fit inside that window.
 */
export function hasOwnScheduleRule(
  item: Pick<ItemData, "cellValues">,
  columns?: OwnScheduleRuleColumns
): boolean {
  if (!columns) return false;
  for (const columnId of [columns.predColumnId, columns.manualStartColumnId]) {
    if (!columnId) continue;
    const value = item.cellValues.find((cv) => cv.columnId === columnId)?.value;
    if (typeof value === "string" && value.trim() !== "") return true;
  }
  return false;
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

/**
 * For every item with a resolvable date range, spreads each assignee's load
 * across every day in that range, accumulated per user. An assignee is a
 * Gantt Assignment (real allocationPct) or a PERSON-column value (負責人/
 * Resource, no allocation of its own so it's spread at 100% unless a real
 * Assignment already covers that user) — the same two mechanisms
 * isItemAssignedToUser treats as equivalent everywhere else. Used to detect
 * days where a person is assigned over 100%.
 */
export function computeDailyLoadByUser(
  items: ItemData[],
  startColumnId: string,
  durationColumnId: string,
  personColumnIds: string[] = [],
  mode: GanttDurationMode = "CALENDAR",
  holidays: Set<string> = new Set()
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

    const coveredByAssignment = new Set<string>();
    for (const assignment of item.assignments) {
      addLoad(assignment.userId, range, assignment.allocationPct);
      coveredByAssignment.add(assignment.userId);
    }

    const personIds = item.cellValues
      .filter((cv) => personColumnIds.includes(cv.columnId))
      .flatMap((cv) => getPersonIds(cv.value));
    for (const userId of personIds) {
      if (coveredByAssignment.has(userId)) continue;
      addLoad(userId, range, 100);
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
