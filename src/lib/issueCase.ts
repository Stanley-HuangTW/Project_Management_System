/**
 * ISSUE TRACKER 案件的純函式:Case No、處理天數、問題類型大類、狀態標籤。不碰資料庫。
 */
import { daysBetween } from "@/lib/rangeDuration";

const ISO = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !ISO.test(value)) return false;
  const d = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/** 流水號的分組:發生日期所在的年月(yyyymm)。同一個月共用一條流水號。 */
export function casePeriod(issueDate: string): string {
  if (!isIsoDate(issueDate)) throw new Error("發生日期不正確");
  return issueDate.slice(0, 7).replace("-", "");
}

/** CS + 西元年月日 + - + 流水號(至少 3 位,超過 999 就自然變長)。例:CS20260106-001 */
export function formatCaseNo(issueDate: string, seq: number): string {
  if (!isIsoDate(issueDate)) throw new Error("發生日期不正確");
  if (!Number.isInteger(seq) || seq < 1) throw new Error("流水號不正確");
  return `CS${issueDate.replaceAll("-", "")}-${String(seq).padStart(3, "0")}`;
}

export type IssueDayMode = "WORKDAY" | "CALENDAR";

/**
 * 處理天數(含頭尾):發生日期 → 結案日期。系統設定決定算工作天(排除週六日與公司假日)或日曆天。
 * 沒有結案日期或日期不合理回 null(Sheet 上顯示 N/A)。
 */
export function processingDays(
  issueDate: string,
  closeDate: string | null,
  mode: IssueDayMode,
  holidays: Set<string> = new Set()
): number | null {
  if (!closeDate) return null;
  return daysBetween(issueDate, closeDate, mode === "WORKDAY" ? "business" : "calendar", holidays);
}

/** 還沒結案的案件「已經開了幾天」(到 today 為止,含頭尾)。 */
export function openDays(
  issueDate: string,
  today: string,
  mode: IssueDayMode,
  holidays: Set<string> = new Set()
): number | null {
  return daysBetween(issueDate, today, mode === "WORKDAY" ? "business" : "calendar", holidays);
}

export const ISSUE_STATUS_LABELS = {
  OPEN: "處理中",
  TC: "暫時解決",
  PC: "永久解決",
  NA: "不適用",
} as const;

export const ISSUE_KIND_LABELS = { REPAIR: "維修 Repair", ISSUE: "問題 Issue" } as const;

export const ISSUE_PRIORITY_LABELS = { P0: "P0 緊急", P1: "P1 高", P2: "P2 一般", P3: "P3 低" } as const;

export const ISSUE_LOG_KIND_LABELS = {
  RESPONSE: "回應/分析",
  ARRANGEMENT: "處理安排",
  SOLUTION: "解決方案",
  NOTE: "備註",
  STAGE: "流程",
} as const;

/** TC 與 PC 都算「已解決」(Sheet 的 Dashboard 也把兩者都當已結案);NA 不算已解決也不算未結。 */
export function isResolvedStatus(status: keyof typeof ISSUE_STATUS_LABELS): boolean {
  return status === "TC" || status === "PC";
}

const ERROR_TYPE_CATEGORIES: Record<string, string> = {
  SW: "軟體",
  HW: "硬體",
  CN: "查無問題/操作",
  LM: "設計限制",
  OP: "安裝/操作錯誤",
};

/** 問題類型名稱前綴(HW02-刀盤馬達異常 的 HW)就是大類;沒有前綴的歸「其他」。 */
export function errorTypeCategory(name: string | null | undefined): string {
  const m = /^([A-Za-z]{2})\s?\d/.exec((name ?? "").trim());
  if (!m) return "其他";
  return ERROR_TYPE_CATEGORIES[m[1].toUpperCase()] ?? "其他";
}
