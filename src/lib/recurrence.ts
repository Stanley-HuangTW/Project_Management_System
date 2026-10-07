/**
 * 工時的重複設定(例行會議):從某一天起,每週的哪幾天、或每月同一天,重複到某一天為止。純邏輯。
 *
 * 規則是「從起始日到結束日之間,符合條件的每一天」——起始日不符合條件(例如週二起、只選週一)
 * 就不算,第一筆是之後第一個符合的日子,畫面上的預覽會寫出來。
 */
import { addDaysIso, isValidIsoDate } from "./timesheet";
import { formatWeekdays } from "./timeTemplates";

export type RecurrenceRule =
  /** weekdays:1 = 週一 … 7 = 週日 */
  | { type: "weekly"; weekdays: number[] }
  /** 每月和起始日同一號;沒有那一號的月份(例如 31 號遇到 2 月)跳過。 */
  | { type: "monthly" };

/** 一次最多建立幾筆。再多通常是設錯了,而且一筆一筆走登記流程也會很慢。 */
export const MAX_OCCURRENCES = 120;
/** 結束日離起始日最遠幾天。 */
export const MAX_RANGE_DAYS = 400;

const DAY_MS = 86_400_000;

function isoWeekday(dateIso: string): number {
  return ((new Date(`${dateIso}T00:00:00Z`).getUTCDay() + 6) % 7) + 1;
}

/** "YYYY-MM-DD" 的日期是星期幾:1 = 週一 … 7 = 週日。 */
export function weekdayOf(dateIso: string): number {
  return isoWeekday(dateIso);
}

/** 符合規則的日期,由早到晚,最多 MAX_OCCURRENCES + 1 筆(多一筆是讓 validate 看得出超過了)。 */
export function recurrenceDates(start: string, rule: RecurrenceRule, until: string): string[] {
  if (!isValidIsoDate(start) || !isValidIsoDate(until) || until < start) return [];
  const spanDays = Math.round((Date.parse(`${until}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / DAY_MS);
  const out: string[] = [];
  const startDay = Number(start.slice(8));
  const weekdays = rule.type === "weekly" ? new Set(rule.weekdays) : null;
  for (let i = 0; i <= spanDays && out.length <= MAX_OCCURRENCES; i++) {
    const date = addDaysIso(start, i);
    const matches = weekdays ? weekdays.has(isoWeekday(date)) : Number(date.slice(8)) === startDay;
    if (matches) out.push(date);
  }
  return out;
}

/** 回錯誤訊息,沒問題回 null。 */
export function validateRecurrence(start: string, rule: RecurrenceRule, until: string): string | null {
  if (!isValidIsoDate(start)) return "請選擇日期";
  if (!isValidIsoDate(until)) return "請選擇重複到哪一天";
  if (until < start) return "結束日不能早於起始日";
  if (Date.parse(`${until}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`) > MAX_RANGE_DAYS * DAY_MS) {
    return `重複的範圍不要超過 ${MAX_RANGE_DAYS} 天`;
  }
  if (rule.type === "weekly") {
    if (rule.weekdays.length === 0) return "請至少選一天";
    if (rule.weekdays.some((d) => !Number.isInteger(d) || d < 1 || d > 7)) return "星期不正確";
  }
  const count = recurrenceDates(start, rule, until).length;
  if (count === 0) return "這個範圍內沒有符合的日期";
  if (count > MAX_OCCURRENCES) return `一次最多建立 ${MAX_OCCURRENCES} 筆,請縮短結束日`;
  return null;
}

/** 一句話說明,例如「每週一、週三,到 2026-12-31」。 */
export function describeRecurrence(rule: RecurrenceRule, until: string): string {
  return `${rule.type === "weekly" ? `每${formatWeekdays(rule.weekdays)}` : "每月同一天"},到 ${until}`;
}
