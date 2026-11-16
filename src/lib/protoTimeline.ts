import type { WeekColumn } from "@/lib/workload";
import { withWeekday } from "@/lib/weekdayLabel";

/**
 * 儀表板「樣機使用時程」的時間軸:同一段期間可以用日、週、月三種刻度看。
 * 期間取自儀表板算好的週欄位(最多 60 週):從第一週的週一,到最後一週的週日。
 * 純函式,不碰畫面,所以測得到。
 */

export type TimelineZoom = "day" | "week" | "month";

export const ZOOM_LABELS: Record<TimelineZoom, string> = { day: "日", week: "週", month: "月" };

/** 一欄多寬(px)。日刻度一欄只有一天,窄;月刻度一欄一個月,寬。 */
export const ZOOM_COL_WIDTH: Record<TimelineZoom, number> = { day: 16, week: 26, month: 72 };

export type TimelineColumn = {
  /** 這一欄涵蓋的第一天、最後一天(含)。 */
  start: Date;
  end: Date;
  /** 欄標題(第二列):日 = 幾號、週 = 那週週一的月/日、月 = 幾月。 */
  label: string;
  /** 滑過去顯示的完整說明。 */
  title: string;
  /** 欄標題上面那一列的分組:日 / 週 = 年/月、月 = 年。 */
  group: string;
  /** 這一欄是新分組的開始(畫分隔線用)。 */
  isGroupStart: boolean;
};

const DAY_MS = 86_400_000;
const addDays = (date: Date, days: number) => new Date(date.getTime() + days * DAY_MS);
const iso = (date: Date) => date.toISOString().slice(0, 10);

export function buildTimelineColumns(weeks: WeekColumn[], zoom: TimelineZoom): TimelineColumn[] {
  if (weeks.length === 0) return [];

  if (zoom === "week") {
    return weeks.map((w) => ({
      start: w.start,
      end: addDays(w.start, 6),
      label: w.label,
      title: `${w.label} 起的一週`,
      group: w.monthLabel,
      isGroupStart: w.isMonthStart,
    }));
  }

  const first = weeks[0].start;
  const last = addDays(weeks[weeks.length - 1].start, 6);

  if (zoom === "day") {
    const columns: TimelineColumn[] = [];
    for (let day = first; day <= last; day = addDays(day, 1)) {
      columns.push({
        start: day,
        end: day,
        label: String(day.getUTCDate()),
        title: withWeekday(iso(day)),
        group: `${day.getUTCFullYear()}/${day.getUTCMonth() + 1}`,
        isGroupStart: columns.length === 0 || day.getUTCDate() === 1,
      });
    }
    return columns;
  }

  const columns: TimelineColumn[] = [];
  let year = first.getUTCFullYear();
  let month = first.getUTCMonth();
  for (;;) {
    const monthStart = new Date(Date.UTC(year, month, 1));
    if (monthStart > last) break;
    const monthEnd = new Date(Date.UTC(year, month + 1, 0));
    columns.push({
      start: monthStart < first ? first : monthStart,
      end: monthEnd > last ? last : monthEnd,
      label: `${month + 1}月`,
      title: `${year}/${month + 1}`,
      group: String(year),
      isGroupStart: columns.length === 0 || month === 0,
    });
    month += 1;
    if (month > 11) {
      month = 0;
      year += 1;
    }
  }
  return columns;
}

/** 欄標題上面那一列:相鄰、分組名一樣的欄合成一格。 */
export function groupColumns(columns: TimelineColumn[]): { label: string; count: number }[] {
  const groups: { label: string; count: number }[] = [];
  for (const column of columns) {
    const last = groups[groups.length - 1];
    if (last && last.label === column.group) last.count += 1;
    else groups.push({ label: column.group, count: 1 });
  }
  return groups;
}

/** 這個日期落在第幾欄:最後一個起點不晚於它的欄;比第一欄還早就是第 0 欄,比最後還晚就是最後一欄。 */
export function columnIndexForDate(date: Date, columns: TimelineColumn[]): number {
  for (let i = columns.length - 1; i >= 0; i--) {
    if (date >= columns[i].start) return i;
  }
  return 0;
}

/** 某個日期在時間軸上的水平位置(px,從第一欄左緣算起);不在這段期間內回 null。 */
export function pixelForDate(date: Date, columns: TimelineColumn[], columnWidth: number): number | null {
  if (columns.length === 0) return null;
  const last = columns[columns.length - 1];
  if (date < columns[0].start || date >= addDays(last.end, 1)) return null;
  const index = columnIndexForDate(date, columns);
  const column = columns[index];
  const span = (addDays(column.end, 1).getTime() - column.start.getTime()) / DAY_MS;
  const into = (date.getTime() - column.start.getTime()) / DAY_MS;
  return index * columnWidth + (into / span) * columnWidth;
}

/** 每一欄的負載:這一欄涵蓋的每一天裡最滿的那一天(跟原本的「週格取最滿的一天」同一個規則)。 */
export function columnPeaks(dailyLoad: Record<string, number> | undefined, columns: TimelineColumn[]): number[] {
  return columns.map((column) => {
    if (!dailyLoad) return 0;
    let peak = 0;
    for (let day = column.start; day <= column.end; day = addDays(day, 1)) {
      const load = dailyLoad[iso(day)];
      if (load !== undefined && load > peak) peak = load;
    }
    return peak;
  });
}
