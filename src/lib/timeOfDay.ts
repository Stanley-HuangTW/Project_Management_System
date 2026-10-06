/**
 * 一天中的時間(行事曆用)。以「從 00:00 起算的分鐘數」存,不帶日期與時區——工時本來就是
 * 「某一天做了幾小時」,開始時間只是用來在那一天裡排位置。
 */

export const MINUTES_PER_DAY = 24 * 60;

/** 開始時間要是一天之內的整數分鐘,而且加上工時不能跨過午夜。null/undefined 代表沒排時間。 */
export function validateStartMinute(startMinute: number | null | undefined, hours: number): string | null {
  if (startMinute === null || startMinute === undefined) return null;
  if (!Number.isInteger(startMinute) || startMinute < 0 || startMinute >= MINUTES_PER_DAY) return "開始時間不正確";
  if (startMinute + Math.round(hours * 60) > MINUTES_PER_DAY) return "開始時間加上工時不能跨過午夜";
  return null;
}

/** 525 → "08:45"。 */
export function formatMinute(minute: number): string {
  const h = Math.floor(minute / 60);
  const m = minute % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** "08:45" → 525;格式不對回 null。 */
export function parseMinute(text: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(text.trim());
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (h > 23 || m > 59) return null;
  return h * 60 + m;
}

/** 對齊到最近的 step 分鐘(拖曳時用),並夾在一天之內。 */
export function snapMinute(minute: number, step = 15): number {
  return Math.min(MINUTES_PER_DAY - step, Math.max(0, Math.round(minute / step) * step));
}
