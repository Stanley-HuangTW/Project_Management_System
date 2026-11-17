/**
 * ISSUE TRACKER 統整頁的計算。純函式:輸入一串案件(已經查好、攤平成字串),輸出各產品的統計。
 *
 * 對應原 Sheet:
 *  - Data Sheet 的「Error Type 次數 / 佔比 / 累計佔比」→ errorTypes(柏拉圖)
 *  - Repair Parts 的「零件被更換次數 / 佔比 / 累計佔比」→ parts
 *  - Reliability 的 RMA 件數 → rma / rmaCuttingDisk
 *  - Dashboard 的 <7 天、7–14 天、<30 天時間窗與近 30 天 Open / 已結清單 → windowCounts / recentLists
 */
import { errorTypeCategory, processingDays, type IssueDayMode } from "@/lib/issueCase";
import { daysBetween } from "@/lib/rangeDuration";

export type StatCase = {
  id: string;
  caseNo: string;
  issueDate: string;
  closeDate: string | null;
  status: "OPEN" | "TC" | "PC" | "NA";
  kind: "REPAIR" | "ISSUE";
  product: string | null;
  customer: string | null;
  region: string | null;
  warranty: string | null;
  errorType: string | null;
  /** 更換的零件:name 是完整料號/規格,shortName 是簡稱(沒有就用 name)。 */
  parts: { name: string; shortName: string | null }[];
  rma: boolean;
  rmaCuttingDisk: boolean;
  createdAt: string;
  firstResponseAt: string | null;
  /** 連到這個案件的工時小時數合計(沒有登記工時是 0)。 */
  workHours: number;
};

export type ParetoRow = { name: string; count: number; pct: number; cumPct: number };

/** 由多到少排,算佔比與累計佔比(同數量依名稱排,結果才穩定)。 */
export function pareto(labels: string[]): ParetoRow[] {
  const counts = new Map<string, number>();
  for (const l of labels) counts.set(l, (counts.get(l) ?? 0) + 1);
  const total = labels.length;
  const rows = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "zh-Hant"));
  let cum = 0;
  return rows.map(([name, count]) => {
    cum += count;
    return { name, count, pct: total ? count / total : 0, cumPct: total ? cum / total : 0 };
  });
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function mean(values: number[]): number | null {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

export type SummaryOptions = { mode: IssueDayMode; holidays: Set<string>; today: string };

export type ProductSummary = {
  product: string;
  total: number;
  open: number;
  tc: number;
  pc: number;
  na: number;
  rma: number;
  rmaCuttingDisk: number;
  /** 平均 / 中位處理天數(只算有結案日期的案件;天數怎麼算看系統設定)。 */
  avgDays: number | null;
  medianDays: number | null;
  /** 首次回覆時間平均(小時)。只算有記錄的案件。 */
  avgFirstResponseHours: number | null;
  /** 花費工時:登記在案件上的小時數合計,與「有登記工時的案件」平均每案幾小時。 */
  totalWorkHours: number;
  avgWorkHoursPerCase: number | null;
  errorTypes: ParetoRow[];
  categories: ParetoRow[];
  parts: ParetoRow[];
  warranty: ParetoRow[];
  customers: ParetoRow[];
  months: { month: string; count: number }[];
};

const NONE = "(未填)";

export function summarize(product: string, cases: StatCase[], opts: SummaryOptions): ProductSummary {
  const days: number[] = [];
  const frt: number[] = [];
  for (const c of cases) {
    const d = processingDays(c.issueDate, c.closeDate, opts.mode, opts.holidays);
    if (d !== null) days.push(d);
    if (c.firstResponseAt) {
      const hours = (Date.parse(c.firstResponseAt) - Date.parse(c.createdAt)) / 3_600_000;
      if (Number.isFinite(hours) && hours >= 0) frt.push(hours);
    }
  }
  const byMonth = new Map<string, number>();
  for (const c of cases) byMonth.set(c.issueDate.slice(0, 7), (byMonth.get(c.issueDate.slice(0, 7)) ?? 0) + 1);
  return {
    product,
    total: cases.length,
    open: cases.filter((c) => c.status === "OPEN").length,
    tc: cases.filter((c) => c.status === "TC").length,
    pc: cases.filter((c) => c.status === "PC").length,
    na: cases.filter((c) => c.status === "NA").length,
    rma: cases.filter((c) => c.rma).length,
    rmaCuttingDisk: cases.filter((c) => c.rmaCuttingDisk).length,
    avgDays: mean(days),
    medianDays: median(days),
    avgFirstResponseHours: mean(frt),
    totalWorkHours: cases.reduce((sum, c) => sum + c.workHours, 0),
    avgWorkHoursPerCase: mean(cases.filter((c) => c.workHours > 0).map((c) => c.workHours)),
    errorTypes: pareto(cases.map((c) => c.errorType ?? NONE)),
    categories: pareto(cases.map((c) => (c.errorType ? errorTypeCategory(c.errorType) : NONE))),
    parts: pareto(cases.flatMap((c) => c.parts.map((p) => p.shortName || p.name))),
    warranty: pareto(cases.map((c) => c.warranty ?? NONE)),
    customers: pareto(cases.map((c) => c.customer ?? NONE)).slice(0, 10),
    months: [...byMonth].sort((a, b) => a[0].localeCompare(b[0])).map(([month, count]) => ({ month, count })),
  };
}

/** 每個產品一份摘要(案件數由多到少),最前面再放「全部」。 */
export function summarizeByProduct(cases: StatCase[], opts: SummaryOptions): ProductSummary[] {
  const groups = new Map<string, StatCase[]>();
  for (const c of cases) {
    const key = c.product ?? NONE;
    groups.set(key, [...(groups.get(key) ?? []), c]);
  }
  const products = [...groups]
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0], "zh-Hant"))
    .map(([name, list]) => summarize(name, list, opts));
  return [summarize("全部", cases, opts), ...products];
}

export type WindowCount = {
  key: "d7" | "d14" | "d30" | "all";
  label: string;
  total: number;
  warranty: ParetoRow[];
  /** 客戶 × 問題類型的組合次數(原 Dashboard 的 customer × 問題簡述)。 */
  customerErrors: { customer: string; errorType: string; count: number }[];
};

/** 案件發生日到 today 的日曆天數(同一天 = 0)。 */
function ageDays(issueDate: string, today: string): number | null {
  const d = daysBetween(issueDate, today, "calendar");
  return d === null ? null : d - 1;
}

export function windowCounts(cases: StatCase[], today: string): WindowCount[] {
  const defs: { key: WindowCount["key"]; label: string; test: (age: number) => boolean }[] = [
    { key: "d7", label: "最近 7 天內", test: (a) => a < 7 },
    { key: "d14", label: "7–14 天前", test: (a) => a >= 7 && a < 15 },
    { key: "d30", label: "最近 30 天內", test: (a) => a < 30 },
    { key: "all", label: "全部", test: () => true },
  ];
  return defs.map((def) => {
    const list = cases.filter((c) => {
      const age = ageDays(c.issueDate, today);
      return age !== null && age >= 0 && def.test(age);
    });
    const combo = new Map<string, { customer: string; errorType: string; count: number }>();
    for (const c of list) {
      const customer = c.customer ?? NONE;
      const errorType = c.errorType ?? NONE;
      const k = `${customer}\u0000${errorType}`;
      const cur = combo.get(k) ?? { customer, errorType, count: 0 };
      cur.count += 1;
      combo.set(k, cur);
    }
    return {
      key: def.key,
      label: def.label,
      total: list.length,
      warranty: pareto(list.map((c) => c.warranty ?? NONE)),
      customerErrors: [...combo.values()].sort((a, b) => b.count - a.count || a.customer.localeCompare(b.customer, "zh-Hant")),
    };
  });
}

/** 近 30 天發生的案件:還在處理的、與已解決(TC / PC)的(原 Dashboard 的 Open(30Days) / Close(30Days))。 */
export function recentLists(cases: StatCase[], today: string): { open: StatCase[]; resolved: StatCase[] } {
  const recent = cases
    .filter((c) => {
      const age = ageDays(c.issueDate, today);
      return age !== null && age >= 0 && age < 30;
    })
    .sort((a, b) => (a.customer ?? "").localeCompare(b.customer ?? "", "zh-Hant") || a.issueDate.localeCompare(b.issueDate));
  return {
    open: recent.filter((c) => c.status === "OPEN"),
    resolved: recent.filter((c) => c.status === "TC" || c.status === "PC"),
  };
}
