import { withWeekday } from "@/lib/weekdayLabel";

const DAY_MS = 86_400_000;

function isoDay(iso: string): number {
  return Date.parse(`${iso.slice(0, 10)}T00:00:00Z`);
}

/** 兩個 YYYY-MM-DD 相差幾天(後 − 前,日曆天);其中一個不是日期就回 null。 */
export function dayDiff(from: string, to: string): number | null {
  const a = isoDay(from);
  const b = isoDay(to);
  return Number.isNaN(a) || Number.isNaN(b) ? null : Math.round((b - a) / DAY_MS);
}

export type DateChange = {
  /** 上次設定(存檔的)那個日期,帶星期;沒設過是「未設定」。 */
  savedLabel: string;
  /** 跟上次設定不一樣時,調整成什麼、差幾天;一樣就是 null。 */
  adjusted: { label: string; delta: string } | null;
};

/**
 * 日期欄位上方的提示:上次設定的是哪一天、現在調成哪一天、差幾天。
 * saved = 存檔的值(打開時的),current = 畫面上現在的值。兩邊都沒有日期就回 null(不用提示)。
 */
export function describeDateChange(saved: string | null | undefined, current: string | null | undefined): DateChange | null {
  const s = saved || null;
  const c = current || null;
  if (!s && !c) return null;
  const savedLabel = s ? withWeekday(s) : "未設定";
  if (s === c) return { savedLabel, adjusted: null };
  if (!c) return { savedLabel, adjusted: { label: "已清除", delta: "" } };
  const label = withWeekday(c);
  if (!s) return { savedLabel, adjusted: { label, delta: "" } };
  const diff = dayDiff(s, c);
  if (diff === null || diff === 0) return { savedLabel, adjusted: { label, delta: "" } };
  return { savedLabel, adjusted: { label, delta: diff > 0 ? `延後 ${diff} 天` : `提前 ${-diff} 天` } };
}
