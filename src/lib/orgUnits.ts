/**
 * 公司組織單位。
 *
 * 本來是 schema 裡的一個列舉,加一個 FAE 就得改 schema、寫 migration、重上
 * 一次版 —— 那不是設定,那是改程式。現在是一張資料表,系統設定裡就能增刪。
 *
 * code 是代號(EE),也是資料庫裡真正存的值;label 是顯示用的全名。改 code
 * 會連動更新所有引用它的資料列(外鍵是 ON UPDATE CASCADE),所以改名不會
 * 把既有的人月與月薪留在一個沒人認得的代號底下。
 */

export type OrgUnit = { code: string; label: string; order: number };

/** 系統第一次啟動時就有的單位。migration 也是照這份種進去的。 */
export const DEFAULT_ORG_UNITS: OrgUnit[] = [
  { code: "EE", label: "EE 電機", order: 0 },
  { code: "ME", label: "ME 機構", order: 1 },
  { code: "SW", label: "SW 軟體", order: 2 },
  { code: "QA", label: "QA 品保", order: 3 },
  { code: "FAE", label: "FAE 技術支援", order: 4 },
  { code: "PM", label: "PM 專案", order: 5 },
];

/** 顯示用的全名。查不到就回代號本身 —— 寧可顯示 EE,也不要顯示空白。 */
export function unitLabel(units: OrgUnit[], code: string | null | undefined): string {
  if (!code) return "";
  return units.find((u) => u.code === code)?.label ?? code;
}

export function unitCodes(units: OrgUnit[]): string[] {
  return units.map((u) => u.code);
}

/**
 * 代號的格式。會進資料庫當主鍵、也會出現在欄位標題上,所以限制得緊一點:
 * 英數與連字號,一律轉大寫,這樣 ee 跟 EE 不會變成兩個單位。
 */
export function normalizeUnitCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s+/g, "-");
}

export function checkUnitCode(raw: string): { ok: true; code: string } | { ok: false; reason: string } {
  const code = normalizeUnitCode(raw);
  if (!code) return { ok: false, reason: "代號不可為空" };
  if (code.length > 12) return { ok: false, reason: "代號最多 12 個字" };
  if (!/^[A-Z0-9-]+$/.test(code)) return { ok: false, reason: "代號只能用英文、數字與連字號" };
  return { ok: true, code };
}

/**
 * 從名額代號猜單位 —— 「EE1」猜 EE、「SW3」猜 SW。
 *
 * 長的代號先比:不然 "EE" 會先攔下本來該歸給 "EEDM" 的那一個。猜不到就
 * 回 null,由呼叫端決定要不要落到預設值,這裡不替它挑。
 */
export function guessUnitCode(units: OrgUnit[], label: string): string | null {
  const text = label.trim().toUpperCase();
  if (!text) return null;
  const sorted = [...units].sort((a, b) => b.code.length - a.code.length);
  return sorted.find((u) => text.startsWith(u.code))?.code ?? null;
}
