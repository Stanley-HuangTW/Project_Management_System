import type { GanttDurationMode } from "@prisma/client";

function isWeekend(date: Date): boolean {
  const day = date.getUTCDay();
  return day === 0 || day === 6;
}

// toISOString 很慢,而排程、工作量的迴圈每走一天就要轉一次(一個五千項的看板,儀表板光是這個就吃掉
// 六成的 CPU 時間)。同一個 UTC 日只轉一次,之後查表。無效的日期照舊在 toISOString 丟出 RangeError。
const isoCache = new Map<number, string>();
export function toIsoDate(date: Date): string {
  const day = Math.floor(date.getTime() / 86_400_000);
  const cached = isoCache.get(day);
  if (cached !== undefined) return cached;
  const iso = date.toISOString().slice(0, 10);
  if (isoCache.size >= 50_000) isoCache.clear();
  isoCache.set(day, iso);
  return iso;
}

/** Weekend, or a date in the given holiday set (company-wide, "YYYY-MM-DD"). */
export function isNonWorkingDay(date: Date, holidays: Set<string> = new Set()): boolean {
  return isWeekend(date) || holidays.has(toIsoDate(date));
}

/**
 * Adds business days (Mon-Fri, excluding the given holidays) to a start
 * date, counting the start date itself as day 1 — i.e.
 * addBusinessDays(start, 1) === start.
 */
export function addBusinessDays(start: Date, days: number, holidays: Set<string> = new Set()): Date {
  const result = new Date(start);
  let remaining = Math.max(0, Math.round(days) - 1);
  while (remaining > 0) {
    result.setUTCDate(result.getUTCDate() + 1);
    if (!isNonWorkingDay(result, holidays)) remaining--;
  }
  return result;
}

/**
 * Counts business days (Mon-Fri, excluding the given holidays) between two
 * dates, inclusive of both ends. Returns null if end is before start.
 */
export function countBusinessDays(start: Date, end: Date, holidays: Set<string> = new Set()): number | null {
  if (end.getTime() < start.getTime()) return null;
  let count = 0;
  const cursor = new Date(start);
  while (cursor.getTime() <= end.getTime()) {
    if (!isNonWorkingDay(cursor, holidays)) count++;
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return count;
}

/**
 * The end date for an item spanning `days` days starting at `start`, per the
 * board's calendar vs business-day duration mode — the same formula
 * getItemDateRange applies to a stored Start+Days pair. Used to preview and
 * apply a whole-bar Gantt drag, where Days must stay exactly what it was
 * before the drag (weekends/holidays crossed by the move should not
 * silently shrink or grow it).
 */
export function endFromStartAndDays(
  start: Date,
  days: number,
  mode: GanttDurationMode,
  holidays: Set<string> = new Set()
): Date {
  if (mode === "BUSINESS") return addBusinessDays(start, Math.max(days, 1), holidays);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + Math.max(days - 1, 0));
  return end;
}

/**
 * Days (inclusive of both ends) between two dates, per the board's calendar
 * vs business-day duration mode. Returns null if end is before start (in
 * CALENDAR mode; countBusinessDays already returns null for that in BUSINESS
 * mode). Mirrors getItemDateRange's own duration semantics so a round-trip
 * through Days stays consistent — used to preview and apply Gantt bar drags.
 */
export function countDaysInRange(
  start: Date,
  end: Date,
  mode: GanttDurationMode,
  holidays: Set<string> = new Set()
): number | null {
  if (mode === "BUSINESS") return countBusinessDays(start, end, holidays);
  if (end.getTime() < start.getTime()) return null;
  return Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;
}

/**
 * Shifts a date forward or backward by deltaDays (negative shifts backward).
 * In CALENDAR mode this is plain date arithmetic; in BUSINESS mode it walks
 * day by day, only counting working days (skipping weekends/holidays) — used
 * for predecessor lag offsets and for deriving a Finish-anchored item's Start
 * (FF/SF), where the walk needs to go in either direction, unlike
 * addBusinessDays' start-anchored "day 1 = start" semantics.
 */
export function shiftDate(
  date: Date,
  deltaDays: number,
  mode: GanttDurationMode,
  holidays: Set<string> = new Set()
): Date {
  if (mode !== "BUSINESS") {
    const result = new Date(date);
    result.setUTCDate(result.getUTCDate() + Math.round(deltaDays));
    return result;
  }
  const direction = deltaDays >= 0 ? 1 : -1;
  let remaining = Math.abs(Math.round(deltaDays));
  const result = new Date(date);
  while (remaining > 0) {
    result.setUTCDate(result.getUTCDate() + direction);
    if (!isNonWorkingDay(result, holidays)) remaining--;
  }
  return result;
}
