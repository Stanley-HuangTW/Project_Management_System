import { addBusinessDays, countBusinessDays } from "@/lib/workday";

/**
 * 期間與天數的換算,給時程對話框用。
 *
 * 兩種算法:日曆天把週末假日都算進去,工作天只算上班的日子。規則直接借
 * workday.ts —— 甘特圖算長條長度用的是同一套,不然對話框說 20 個工作天,
 * 畫出來的長條卻不是那個長度。
 *
 * 不碰 DOM、不碰資料庫,所以整個測得到。
 */

export type DurationMode = "calendar" | "business";

function toDate(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

function toIso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/**
 * 起訖日之間有幾天(含頭尾)。
 *
 * 結束日早於開始日、或日期不合法都回 null —— 回 0 或負數會讓畫面顯示一個
 * 看起來合理的錯誤天數。
 */
export function daysBetween(
  startIso: string,
  endIso: string,
  mode: DurationMode,
  holidays: Set<string> = new Set()
): number | null {
  if (!ISO.test(startIso) || !ISO.test(endIso)) return null;
  const start = toDate(startIso);
  const end = toDate(endIso);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  if (end.getTime() < start.getTime()) return null;

  if (mode === "business") return countBusinessDays(start, end, holidays);
  return Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;
}

/**
 * 從開始日往後推 n 天得到的結束日(開始日算第一天)。
 *
 * 工作天模式下,開始日自己如果是假日,addBusinessDays 仍然把它當第一天 ——
 * 那是甘特圖現有的行為,這裡不另外發明一套。
 */
export function endFromDays(
  startIso: string,
  days: number,
  mode: DurationMode,
  holidays: Set<string> = new Set()
): string | null {
  if (!ISO.test(startIso)) return null;
  if (!Number.isFinite(days) || days < 1) return null;
  const start = toDate(startIso);
  if (Number.isNaN(start.getTime())) return null;

  if (mode === "business") return toIso(addBusinessDays(start, Math.round(days), holidays));

  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + Math.round(days) - 1);
  return toIso(end);
}
