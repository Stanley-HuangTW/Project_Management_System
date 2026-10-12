"use server";

import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { addDaysIso, daysBetweenInclusive } from "@/lib/timesheet";
import { validateCalendarRange } from "@/lib/googleCalendar";
import { loadEstimates } from "@/lib/estimateLoad";
import { estimateImportRows, type EstimateImportRow } from "@/lib/timesheetEstimate";
import { logTime } from "./timeEntry";

/** 一次最多匯入幾筆(跟 Google 日曆匯入同一個量級)。 */
const MAX_IMPORT = 500;

/** 清單上的一列:工作項那一天的預估,加上它在工時裡的狀態。 */
export type EstimateImportListRow = EstimateImportRow & {
  /** new = 還沒登記;logged = 這一天這個工作項已經登記過工時(不能重複匯入)。 */
  state: "new" | "logged";
  /** 已經登記的時數(logged 才有)。 */
  loggedHours: number | null;
};

export type EstimateImportList =
  | { status: "ok"; rows: EstimateImportListRow[]; hoursPerDay: number }
  | { status: "error"; message: string };

function daysOf(from: string, to: string): string[] {
  return Array.from({ length: daysBetweenInclusive(from, to) }, (_, i) => addDaysIso(from, i));
}

/**
 * 列出 from 到 to 之間,指派給我的工作項每一天的預估時數(配置比例 × 每日工時,只在工作項起訖之間的工作日),
 * 標出哪些這一天已經登記過工時。只看自己的,而且只算看得到的看板。
 */
export async function listEstimateImport(from: string, to: string): Promise<EstimateImportList> {
  const session = await requireSession();
  const invalid = validateCalendarRange(from, to);
  if (invalid) return { status: "error", message: invalid };

  const days = daysOf(from, to);
  const loaded = await loadEstimates(session, days);
  const rows = estimateImportRows(loaded.projects, days);
  if (rows.length === 0) return { status: "ok", rows: [], hoursPerDay: loaded.hoursPerDay };

  // 被退回的不算「已登記」——可以重新匯入。
  const existing = await prisma.timeEntry.findMany({
    where: {
      userId: session.userId,
      date: { gte: from, lte: to },
      itemId: { in: [...new Set(rows.map((r) => r.itemId))] },
      status: { not: "REJECTED" },
    },
    select: { itemId: true, date: true, hours: true },
  });
  const logged = new Map<string, number>();
  for (const e of existing) logged.set(`${e.itemId}|${e.date}`, (logged.get(`${e.itemId}|${e.date}`) ?? 0) + Number(e.hours));

  return {
    status: "ok",
    hoursPerDay: loaded.hoursPerDay,
    rows: rows.map((r) => {
      const hours = logged.get(r.key);
      return { ...r, state: hours === undefined ? "new" : "logged", loggedHours: hours ?? null };
    }),
  };
}

export type EstimateImportItem = {
  itemId: string;
  date: string;
  /** 實際時數:預設就是預估,使用者可以改。 */
  hours: number;
};

export type EstimateImportResult = {
  created: number;
  /** 這一天這個工作項已經登記過(清單開著的時候別處新增的),略過。 */
  skipped: number;
  failed: string[];
};

/**
 * 把勾選的幾列匯入成專案工時:實際時數用使用者填的(預設是預估),預估時數由伺服器重算後一起存下來——
 * 不信畫面送來的預估,所以畫面上改不了「原預估」。走一般登記(logTime):要核准的照樣要核准、免審核的人直接生效、
 * 一天 24 小時上限、工作項要看得到。這一天這個工作項已經有工時就略過,不會重複建立。
 */
export async function importWorkItemEstimates(items: EstimateImportItem[]): Promise<EstimateImportResult | { error: string }> {
  const session = await requireSession();
  if (items.length === 0) return { error: "請至少勾選一筆" };
  if (items.length > MAX_IMPORT) return { error: `一次最多匯入 ${MAX_IMPORT} 筆` };

  const dates = items.map((i) => i.date).sort();
  const invalid = validateCalendarRange(dates[0], dates[dates.length - 1]);
  if (invalid) return { error: invalid };

  const days = daysOf(dates[0], dates[dates.length - 1]);
  const loaded = await loadEstimates(session, days);
  const estimateOf = new Map(estimateImportRows(loaded.projects, days).map((r) => [r.key, r]));

  const result: EstimateImportResult = { created: 0, skipped: 0, failed: [] };
  for (const item of items) {
    const key = `${item.itemId}|${item.date}`;
    const row = estimateOf.get(key);
    const label = row ? `${item.date} ${row.itemName}` : `${item.date}`;
    if (!row) {
      result.failed.push(`${label}:這一天沒有這個工作項的預估`);
      continue;
    }
    const hours = Math.round(item.hours * 100) / 100;
    if (!Number.isFinite(hours) || hours <= 0 || hours > 24) {
      result.failed.push(`${label}:實際時數要大於 0、不超過 24`);
      continue;
    }
    const already = await prisma.timeEntry.count({
      where: { userId: session.userId, itemId: item.itemId, date: item.date, status: { not: "REJECTED" } },
    });
    if (already > 0) {
      result.skipped++;
      continue;
    }
    try {
      const outcome = await logTime(item.itemId, item.date, hours, "", undefined, null, null, row.estimateHours);
      if (outcome.error) result.failed.push(`${label}:${outcome.error}`);
      else result.created++;
    } catch (err) {
      result.failed.push(`${label}:${err instanceof Error ? err.message : "匯入失敗"}`);
    }
  }
  return result;
}
