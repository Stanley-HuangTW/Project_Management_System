const WEEKDAY_LABELS = ["週日", "週一", "週二", "週三", "週四", "週五", "週六"];

/**
 * "2026-11-12" → "2026-11-12(週四)"。甘特圖上的日期(時程設定、長條的提示、拖曳確認……)都帶星期幾,
 * 排進度的人不用再去翻月曆算那天是不是週末。
 *
 * 星期幾是從這串日期本身算的(當成 UTC 日期,不經過任何時區換算),所以畫面上寫的日期跟星期永遠對得起來。
 * 不是 YYYY-MM-DD、或是不存在的日期(2026-02-30)就原樣還給你,不亂猜。
 */
export function withWeekday(iso: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const date = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== iso) return iso;
  return `${iso}(${WEEKDAY_LABELS[date.getUTCDay()]})`;
}
