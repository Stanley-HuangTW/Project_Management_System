/**
 * 專案群組甘特圖的時間軸標題:依刻度(日 / 週 / 月)把連續的日曆日分段。
 *
 * 週、月刻度一天只有 9px、3px 寬,標題不能一天一格 —— 標籤塞不下、溢出疊在一起,分隔線也密成一團。
 * 要像看板甘特圖一樣:一週(或一個月)合成一格,標籤寫在那一格裡。這裡的日期都是 UTC 午夜
 * (群組甘特圖用日曆日,不跳過非工作日),所以全部用 getUTC*,跟時區無關。
 */

export type HeaderZoom = "day" | "week" | "month";

export type HeaderSegment = {
  /** 這一格第一天的 "YYYY-MM-DD"。 */
  key: string;
  label: string;
  /** 週刻度才有:「第 47 週」。 */
  sublabel?: string;
  /** 這一格涵蓋幾天(寬度 = days × 每天的寬度)。 */
  days: number;
};

const DAY_MS = 86_400_000;
const iso = (date: Date) => date.toISOString().slice(0, 10);

/** ISO 8601 週數(1–53):包含該年第一個星期四的那週是第 1 週。 */
export function isoWeekNumberUtc(date: Date): number {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / DAY_MS + 1) / 7);
}

/** 這一天所在那週的週一("YYYY-MM-DD")。 */
export function mondayOfWeekUtc(date: Date): string {
  const day = date.getUTCDay();
  return iso(new Date(date.getTime() + (day === 0 ? -6 : 1 - day) * DAY_MS));
}

export function buildHeaderSegmentsUtc(days: Date[], zoom: HeaderZoom): HeaderSegment[] {
  if (zoom === "day") {
    return days.map((d) => ({ key: iso(d), label: `${d.getUTCMonth() + 1}/${d.getUTCDate()}`, days: 1 }));
  }
  const segments: HeaderSegment[] = [];
  let bucket: Date[] = [];
  const flush = () => {
    if (bucket.length === 0) return;
    const start = bucket[0];
    segments.push({
      key: iso(start),
      label: zoom === "week" ? `${start.getUTCMonth() + 1}/${start.getUTCDate()}` : `${start.getUTCFullYear()}/${start.getUTCMonth() + 1}`,
      sublabel: zoom === "week" ? `第${isoWeekNumberUtc(start)}週` : undefined,
      days: bucket.length,
    });
    bucket = [];
  };
  for (const d of days) {
    const last = bucket[bucket.length - 1];
    // 拿實際的日曆邊界跟這一格最後一天比,不是只認「週一 / 1 號」:期間的頭尾常常不是整週、整月,
    // 第一格(或最後一格)只涵蓋那幾天,寬度照實際天數。
    const startsNewBucket =
      last !== undefined &&
      (zoom === "week"
        ? mondayOfWeekUtc(d) !== mondayOfWeekUtc(last)
        : d.getUTCFullYear() !== last.getUTCFullYear() || d.getUTCMonth() !== last.getUTCMonth());
    if (startsNewBucket) flush();
    bucket.push(d);
  }
  flush();
  return segments;
}
