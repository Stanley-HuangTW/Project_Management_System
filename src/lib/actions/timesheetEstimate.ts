"use server";

import { requireSession } from "@/lib/session";
import { weekRangeOf } from "@/lib/weeklyReport";
import { isValidIsoDate, weekDays } from "@/lib/timesheet";
import { loadEstimates } from "@/lib/estimateLoad";
import type { EstimateWeek } from "@/lib/timesheetEstimate";

/**
 * 我這一週的工時預估(人力表預估 + 工作項預估),給「我的工時」跟實際登記的工時並排看。
 *
 * 只看自己的,而且只算看得到的看板。實際工時不在這裡——畫面已經有這一週的登記,
 * 直接用它,修改工時後對照表才會立刻跟著變,不必再來回一趟伺服器。
 */
export async function getMyEstimates(weekStart: string): Promise<EstimateWeek | { error: string }> {
  const session = await requireSession();
  if (!isValidIsoDate(weekStart)) return { error: "日期格式不正確" };
  const range = weekRangeOf(weekStart);
  const loaded = await loadEstimates(session, weekDays(range.weekStart));
  return { weekStart: range.weekStart, ...loaded };
}
