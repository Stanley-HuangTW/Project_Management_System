"use server";

import { prisma } from "@/lib/prisma";
import { requireIssueActor } from "@/lib/issueServer";
import { listHolidays, toHolidaySet } from "@/lib/holidays";
import { taipeiTodayIso } from "@/lib/timesheet";
import { issueDayModeSetting } from "@/lib/issueSettingsServer";
import { isIsoDate } from "@/lib/issueCase";
import {
  recentLists,
  summarizeByProduct,
  windowCounts,
  type ProductSummary,
  type StatCase,
  type WindowCount,
} from "@/lib/issueStats";

export type IssueStatsResult = {
  summaries: ProductSummary[];
  windows: WindowCount[];
  recent: { open: StatCase[]; resolved: StatCase[] };
  today: string;
  dayMode: "WORKDAY" | "CALENDAR";
  /** 沒有任何案件落在區間內(畫面顯示空狀態用)。 */
  empty: boolean;
};

/**
 * 各產品統整:區間內每個產品(與全部)的案件數、狀態、RMA、處理天數、首次回覆時間、問題類型 / 零件柏拉圖、月趨勢;
 * 另外不受區間限制的「最近 7 / 14 / 30 天」時間窗與近 30 天處理中 / 已解決清單。所有 ISSUE TRACKER 使用者都看得到。
 */
export async function getIssueStats(range: { from?: string; to?: string }): Promise<IssueStatsResult> {
  await requireIssueActor();
  const [rows, mode, holidays, hourSums] = await Promise.all([
    prisma.issueCase.findMany({
      where: { deletedAt: null },
      include: {
        customer: { select: { name: true } },
        product: { select: { name: true } },
        region: { select: { name: true } },
        warranty: { select: { name: true } },
        errorType: { select: { name: true } },
        parts: { orderBy: { order: "asc" }, select: { part: { select: { name: true, shortName: true } } } },
      },
    }),
    issueDayModeSetting(),
    listHolidays(),
    prisma.activityTimeEntry.groupBy({ by: ["issueCaseId"], where: { issueCaseId: { not: null } }, _sum: { hours: true } }),
  ]);
  const hoursOf = new Map(hourSums.map((h) => [h.issueCaseId, Number(h._sum.hours ?? 0)]));
  const today = taipeiTodayIso();
  const all: StatCase[] = rows.map((c) => ({
    id: c.id,
    caseNo: c.caseNo,
    issueDate: c.issueDate,
    closeDate: c.closeDate,
    status: c.status,
    kind: c.kind,
    product: c.product?.name ?? null,
    customer: c.customer?.name ?? null,
    region: c.region?.name ?? null,
    warranty: c.warranty?.name ?? null,
    errorType: c.errorType?.name ?? null,
    parts: c.parts.map((p) => ({ name: p.part.name, shortName: p.part.shortName })),
    rma: c.rma,
    rmaCuttingDisk: c.rmaCuttingDisk,
    createdAt: c.createdAt.toISOString(),
    firstResponseAt: c.firstResponseAt?.toISOString() ?? null,
    workHours: hoursOf.get(c.id) ?? 0,
  }));
  const from = range.from && isIsoDate(range.from) ? range.from : null;
  const to = range.to && isIsoDate(range.to) ? range.to : null;
  const inRange = all.filter((c) => (!from || c.issueDate >= from) && (!to || c.issueDate <= to));
  return {
    summaries: summarizeByProduct(inRange, { mode, holidays: toHolidaySet(holidays), today }),
    windows: windowCounts(all, today),
    recent: recentLists(all, today),
    today,
    dayMode: mode,
    empty: inRange.length === 0,
  };
}
