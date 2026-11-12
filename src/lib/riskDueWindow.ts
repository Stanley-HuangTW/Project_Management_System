import { withWeekday } from "@/lib/weekdayLabel";

export type DueWindowNote = {
  /** ok = 落在期間內;warn = 超出期間;info = 還不能比(沒設到期日或工作項沒有日期)。 */
  tone: "ok" | "warn" | "info";
  text: string;
};

const DAY = 86_400_000;
const dayNumber = (iso: string) => Math.floor(new Date(`${iso}T00:00:00Z`).getTime() / DAY);
const isIso = (value: string | null | undefined): value is string => !!value && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(`${value}T00:00:00Z`).getTime());

/**
 * 風險 / 議題的「對策到期日」跟它掛的工作項的時間比起來:有沒有落在那個工作項的開始日 ~ 結束日之內。
 * 對策要在工作項做完之前解除才有意義——期限比工作項的結束日還晚,或比開始日還早,都提醒一聲。
 * 只做提示,不擋存檔(期限本來就可以訂在工作項之外)。
 */
export function describeDueAgainstItem(due: string | null, start: string | null, end: string | null): DueWindowNote {
  const hasStart = isIso(start);
  const hasEnd = isIso(end);
  if (!hasStart && !hasEnd) return { tone: "info", text: "這個工作項還沒有排日期,無法比對對策到期日。" };
  if (!isIso(due)) return { tone: "info", text: "還沒有設定對策到期日。設定後這裡會告訴你有沒有落在這個工作項的時間內。" };
  const d = dayNumber(due);
  const dueText = withWeekday(due);
  if (hasEnd && d > dayNumber(end)) {
    return { tone: "warn", text: `對策到期日 ${dueText} 比工作項結束日 ${withWeekday(end)} 晚 ${d - dayNumber(end)} 天,超出這個工作項的時間。` };
  }
  if (hasStart && d < dayNumber(start)) {
    return { tone: "warn", text: `對策到期日 ${dueText} 比工作項開始日 ${withWeekday(start)} 早 ${dayNumber(start) - d} 天,在這個工作項開始之前。` };
  }
  return { tone: "ok", text: `對策到期日 ${dueText} 落在這個工作項的時間內。` };
}
