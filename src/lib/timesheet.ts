import { weekRangeOf, isoWeekLabel } from "./weeklyReport";

/** 統計裡專案工作項工時(TimeEntry)歸在這個「類別」底下,跟非專案類別並排。 */
export const PROJECT_CATEGORY_LABEL = "專案工作項";

/** 統計裡沒有對應任何專案的工時(部門週會、公司專案週會、請假…)歸在這個「專案」底下。 */
export const UNASSIGNED_PROJECT_LABEL = "未歸屬專案";

/** 一次統計最多看這麼多天——日粒度每天一欄,區間太長畫面就沒法讀了。 */
export const MAX_STATS_RANGE_DAYS = 366;

export type Granularity = "day" | "week" | "month";

export type TimesheetViewer = {
  id: string;
  role: "ADMIN" | "SUPERVISOR" | "MEMBER";
  /** 管理員指定給個別主管的「可檢視全部成員工時」權限。 */
  canViewAllTimesheets: boolean;
};

/**
 * 看不看得到某個人的工時:本人、ADMIN、被指定可看全部的人、他的直屬主管。
 *
 * 只認直屬(supervisorId 相等),不往上推整條主管鏈——跟「待我審核」同一個
 * 規則(approval.ts 的 approvableUserIds)。要讓更高階主管看到底下全部人,
 * 就是 canViewAllTimesheets 這個旗標存在的理由。
 */
export function canViewTimesheetOf(
  viewer: TimesheetViewer,
  target: { id: string; supervisorId: string | null }
): boolean {
  if (viewer.id === target.id) return true;
  if (viewer.role === "ADMIN") return true;
  if (viewer.canViewAllTimesheets) return true;
  return target.supervisorId === viewer.id;
}

const DAY_MS = 86_400_000;

function utc(dayIso: string): Date {
  return new Date(`${dayIso}T00:00:00.000Z`);
}

function iso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function isValidIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = utc(value);
  return !Number.isNaN(date.getTime()) && iso(date) === value;
}

export function addDaysIso(dayIso: string, days: number): string {
  return iso(new Date(utc(dayIso).getTime() + days * DAY_MS));
}

/** 含頭含尾的天數。 */
export function daysBetweenInclusive(fromIso: string, toIso: string): number {
  return Math.round((utc(toIso).getTime() - utc(fromIso).getTime()) / DAY_MS) + 1;
}

export function monthRangeOf(dayIso: string): { monthStart: string; monthEnd: string } {
  const date = utc(dayIso);
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  return {
    monthStart: iso(new Date(Date.UTC(year, month, 1))),
    monthEnd: iso(new Date(Date.UTC(year, month + 1, 0))),
  };
}

/** 週一起算的七天。 */
export function weekDays(weekStartIso: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDaysIso(weekStartIso, i));
}

/**
 * 台灣的今天(固定 UTC+8,台灣沒有日光節約)。直接用 toISOString 的 UTC 日期,
 * 台灣凌晨 0~8 點會算成「昨天」。由 server 算好當 prop 傳給畫面,client 不自己
 * 呼叫——server 跟 client 各自算一次,時區不同就會 hydration 不一致。
 */
export function taipeiTodayIso(): string {
  return iso(new Date(Date.now() + 8 * 3_600_000));
}

/** 這一天落在哪個時間桶:日=日期本身、週=那週的週一、月="YYYY-MM"。 */
export function bucketKeyOf(dayIso: string, granularity: Granularity): string {
  if (granularity === "day") return dayIso;
  if (granularity === "week") return weekRangeOf(dayIso).weekStart;
  return dayIso.slice(0, 7);
}

/** 區間內依序出現的時間桶(不重複)。第一個/最後一個桶可能只涵蓋區間的一部分。 */
export function bucketKeysInRange(fromIso: string, toIso: string, granularity: Granularity): string[] {
  const keys: string[] = [];
  const total = daysBetweenInclusive(fromIso, toIso);
  for (let i = 0; i < total; i++) {
    const key = bucketKeyOf(addDaysIso(fromIso, i), granularity);
    if (keys[keys.length - 1] !== key) keys.push(key);
  }
  return keys;
}

export function bucketLabel(key: string, granularity: Granularity): string {
  if (granularity === "day") return key.slice(5);
  if (granularity === "week") return `${isoWeekLabel(key)}(${key.slice(5)}起)`;
  return key;
}

/** 專案工時跟非專案工時合併之後的一筆——統計只認這個形狀。 */
export type TimesheetRow = {
  userId: string;
  date: string;
  hours: number;
  categoryLabel: string;
  /** 這筆工時算在哪個專案(看板名稱);沒有就是 UNASSIGNED_PROJECT_LABEL。 */
  projectLabel?: string;
};

/** 「各類別工時」表的一欄:專案底下的一個類別。 */
export type CategoryColumn = { key: string; project: string; category: string };

export function categoryColumnKey(project: string, category: string): string {
  return `${project}\u0000${category}`;
}

export type TimesheetUserStats = {
  userId: string;
  total: number;
  byBucket: Record<string, number>;
  byCategory: Record<string, number>;
  /** 專案 × 類別(key 見 categoryColumnKey)。 */
  byColumn: Record<string, number>;
};

export type TimesheetStats = {
  buckets: string[];
  /** 專案工作項排第一個,其餘照名稱排。 */
  categories: string[];
  /** 「各類別工時」的欄:依專案分組(工時多的專案在前,未歸屬專案最後),專案底下專案工作項在前。 */
  columns: CategoryColumn[];
  users: TimesheetUserStats[];
  totals: Omit<TimesheetUserStats, "userId">;
};

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function addTo(record: Record<string, number>, key: string, hours: number) {
  record[key] = (record[key] ?? 0) + hours;
}

function roundRecord(record: Record<string, number>): Record<string, number> {
  return Object.fromEntries(Object.entries(record).map(([key, value]) => [key, round2(value)]));
}

/**
 * 把工時彙總成「每人 × 時間桶」跟「每人 × 類別」兩份,再加一列合計。
 *
 * userOrder 決定列的順序,而且沒有任何工時的人也會留一列(全是 0)——統計
 * 要看的常常正是「誰這段時間一小時都沒登記」。不在 userOrder 裡的人、以及
 * 區間外的日期都直接忽略,呼叫端不用自己先濾一次。
 */
export function aggregateTimesheet(
  rows: TimesheetRow[],
  options: { from: string; to: string; granularity: Granularity; userOrder: string[] }
): TimesheetStats {
  const { from, to, granularity, userOrder } = options;
  const buckets = bucketKeysInRange(from, to, granularity);

  const perUser = new Map<
    string,
    { total: number; byBucket: Record<string, number>; byCategory: Record<string, number>; byColumn: Record<string, number> }
  >(userOrder.map((id) => [id, { total: 0, byBucket: {}, byCategory: {}, byColumn: {} }]));
  const totals = {
    total: 0,
    byBucket: {} as Record<string, number>,
    byCategory: {} as Record<string, number>,
    byColumn: {} as Record<string, number>,
  };
  const categorySet = new Set<string>();
  const columnMap = new Map<string, CategoryColumn>();
  const projectTotal = new Map<string, number>();

  for (const row of rows) {
    if (row.date < from || row.date > to) continue;
    const bucket = perUser.get(row.userId);
    if (!bucket) continue;
    const key = bucketKeyOf(row.date, granularity);
    bucket.total += row.hours;
    addTo(bucket.byBucket, key, row.hours);
    addTo(bucket.byCategory, row.categoryLabel, row.hours);
    const project = row.projectLabel ?? UNASSIGNED_PROJECT_LABEL;
    const columnKey = categoryColumnKey(project, row.categoryLabel);
    addTo(bucket.byColumn, columnKey, row.hours);
    addTo(totals.byColumn, columnKey, row.hours);
    columnMap.set(columnKey, { key: columnKey, project, category: row.categoryLabel });
    projectTotal.set(project, (projectTotal.get(project) ?? 0) + row.hours);
    totals.total += row.hours;
    addTo(totals.byBucket, key, row.hours);
    addTo(totals.byCategory, row.categoryLabel, row.hours);
    categorySet.add(row.categoryLabel);
  }

  const categories = [...categorySet].sort((a, b) => {
    if (a === PROJECT_CATEGORY_LABEL) return -1;
    if (b === PROJECT_CATEGORY_LABEL) return 1;
    return a.localeCompare(b, "zh-TW");
  });

  const columns = [...columnMap.values()].sort((a, b) => {
    if (a.project !== b.project) {
      if (a.project === UNASSIGNED_PROJECT_LABEL) return 1;
      if (b.project === UNASSIGNED_PROJECT_LABEL) return -1;
      return (
        (projectTotal.get(b.project) ?? 0) - (projectTotal.get(a.project) ?? 0) ||
        a.project.localeCompare(b.project, "zh-TW")
      );
    }
    if (a.category === PROJECT_CATEGORY_LABEL) return -1;
    if (b.category === PROJECT_CATEGORY_LABEL) return 1;
    return a.category.localeCompare(b.category, "zh-TW");
  });

  return {
    buckets,
    categories,
    columns,
    users: userOrder.map((userId) => {
      const stats = perUser.get(userId)!;
      return {
        userId,
        total: round2(stats.total),
        byBucket: roundRecord(stats.byBucket),
        byCategory: roundRecord(stats.byCategory),
        byColumn: roundRecord(stats.byColumn),
      };
    }),
    totals: {
      total: round2(totals.total),
      byBucket: roundRecord(totals.byBucket),
      byCategory: roundRecord(totals.byCategory),
      byColumn: roundRecord(totals.byColumn),
    },
  };
}
