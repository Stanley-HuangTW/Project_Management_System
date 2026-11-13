const WEEKDAY_LABELS = ["週日", "週一", "週二", "週三", "週四", "週五", "週六"];

/** "2026-11-12" → "週四";不是 YYYY-MM-DD 或不存在的日期給空字串。 */
export function weekdayOf(iso: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return "";
  const date = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== iso) return "";
  return WEEKDAY_LABELS[date.getUTCDay()];
}

/**
 * "2026-11-12" → "2026-11-12(週四)"。甘特圖上的日期(時程設定、長條的提示、拖曳確認……)都帶星期幾,
 * 排進度的人不用再去翻月曆算那天是不是週末。
 *
 * 星期幾是從這串日期本身算的(當成 UTC 日期,不經過任何時區換算),所以畫面上寫的日期跟星期永遠對得起來。
 * 不是 YYYY-MM-DD、或是不存在的日期(2026-02-30)就原樣還給你,不亂猜。
 */
export function withWeekday(iso: string): string {
  const weekday = weekdayOf(iso);
  return weekday ? `${iso}(${weekday})` : iso;
}

/**
 * 短格式的日期(例如卡片上的 "11/12")後面接星期幾:shortWithWeekday("11/12", "2026-11-12") → "11/12(週四)"。
 * iso 不是合法日期就原樣還給 label。
 */
export function shortWithWeekday(label: string, iso: string): string {
  const weekday = weekdayOf(iso);
  return weekday ? `${label}(${weekday})` : label;
}

/**
 * 時間戳記(建立於、更新於……)的日期部分帶星期幾,跟原本的 toLocaleDateString("zh-TW") 一樣用執行環境的時區:
 * "2026/11/13(週五)"。
 */
export function localeDateWithWeekday(value: Date | string | number): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.toLocaleDateString("zh-TW")}(${WEEKDAY_LABELS[date.getDay()]})`;
}

/** 同上再接時間,取代 toLocaleString("zh-TW"):"2026/11/13(週五) 上午8:46:00"。 */
export function localeDateTimeWithWeekday(value: Date | string | number): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `${localeDateWithWeekday(date)} ${date.toLocaleTimeString("zh-TW")}`;
}
