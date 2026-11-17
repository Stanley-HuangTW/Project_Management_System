/**
 * ISSUE TRACKER 的 Excel 匯入:把「客服維修紀錄」Sheet 匯出的工作表(2024 / 2025 / 2026CSTable 三種版面)
 * 轉成統一的紀錄。純函式,不碰資料庫與檔案;讀 Excel 與寫資料庫在 actions/issueImport.ts。
 *
 * 欄位用「標題文字」對,不用欄位位置 —— 三年的欄位順序不一樣(Error Type 在 P / S / V 欄)。
 */
import { isIsoDate } from "@/lib/issueCase";

export type ImportedCase = {
  /** 工作表名稱 + Excel 列號,錯誤訊息用。 */
  where: string;
  caseNo: string | null;
  kind: "REPAIR" | "ISSUE";
  customer: string | null;
  product: string | null;
  region: string | null;
  customerType: string | null;
  issueDate: string;
  serialNo: string | null;
  qrCode: string | null;
  description: string;
  behavior: string;
  warranty: string | null;
  status: "OPEN" | "TC" | "PC" | "NA";
  closeDate: string | null;
  response: string;
  arrangement: string;
  deckCount: number | null;
  cutHours: number | null;
  wheelHours: number | null;
  errorType: string | null;
  units: string[];
  rma: boolean;
  rmaCuttingDisk: boolean;
  repairOrderNo: string | null;
  parts: string[];
};

export type ImportRowError = { where: string; message: string };

export type ParsedSheet = { sheet: string; recognized: boolean; records: ImportedCase[]; errors: ImportRowError[] };

type Field =
  | "caseNo"
  | "kind"
  | "customer"
  | "product"
  | "region"
  | "customerType"
  | "issueDate"
  | "serialNo"
  | "qrCode"
  | "description"
  | "behavior"
  | "warranty"
  | "status"
  | "closeDate"
  | "response"
  | "arrangement"
  | "deckCount"
  | "cutHours"
  | "wheelHours"
  | "errorType"
  | "unit"
  | "rma"
  | "rmaCuttingDisk"
  | "repairOrderNo";

/** 標題(去空白、小寫)→ 欄位。2024 與 2025/2026 的不同寫法都列進來。 */
const HEADER_ALIASES: Record<string, Field> = {
  "case no": "caseNo",
  "cs number": "caseNo",
  "repair/issue": "kind",
  customer: "customer",
  model: "product",
  產品型號: "product",
  region: "region",
  地區: "region",
  客戶型態: "customerType",
  "issue date": "issueDate",
  發生問題日期: "issueDate",
  "機器序號 (sn)": "serialNo",
  "機器序號(sn)": "serialNo",
  "qr code": "qrCode",
  description: "description",
  問題簡述: "description",
  "specification and behavior": "behavior",
  warranty: "warranty",
  保固狀態: "warranty",
  status: "status",
  "close date": "closeDate",
  結案時間: "closeDate",
  response: "response",
  安排: "arrangement",
  "deck up/down times": "deckCount",
  "cutting hours": "cutHours",
  cut_hr: "cutHours",
  "mowing hours": "cutHours",
  "moving hours": "wheelHours",
  whl_hr: "wheelHours",
  "error type": "errorType",
  處理單位: "unit",
  rma: "rma",
  "rma by cutting disk": "rmaCuttingDisk",
  維修單號: "repairOrderNo",
};

const PART_HEADER = /^更換重要零件\s*\d+$/;

/** 把各種 Excel 儲存格的值變成乾淨的字串(公式取結果、日期轉 yyyy-mm-dd、布林轉 TRUE/FALSE)。 */
export function cellText(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v.trim();
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "";
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? "" : v.toISOString().slice(0, 10);
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    if (Array.isArray(o.richText)) return (o.richText as { text: string }[]).map((t) => t.text).join("").trim();
    if ("result" in o) return cellText(o.result);
    if ("text" in o) return String(o.text ?? "").trim();
  }
  return "";
}

/** Excel 日期序號(1900 系統)轉 yyyy-mm-dd。 */
function serialToIso(serial: number): string | null {
  if (!Number.isFinite(serial) || serial < 20000 || serial > 80000) return null;
  const ms = Date.UTC(1899, 11, 30) + Math.round(serial) * 86_400_000;
  return new Date(ms).toISOString().slice(0, 10);
}

/** 日期:Date 物件、Excel 序號、2026/1/6、2026/01/06、2026-1-6 都收;其他(1/10 沒有年份)不收。 */
export function parseDate(v: unknown): string | null {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
  if (typeof v === "number") return serialToIso(v);
  const t = cellText(v);
  if (!t) return null;
  if (/^\d{5}$/.test(t)) return serialToIso(Number(t));
  const m = /^(\d{4})[/.-](\d{1,2})[/.-](\d{1,2})/.exec(t);
  if (!m) return null;
  const iso = `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  return isIsoDate(iso) ? iso : null;
}

function parseBool(v: unknown): boolean {
  const t = cellText(v).toLowerCase();
  return t === "true" || t === "1" || t === "v" || t === "yes" || t === "是";
}

function parseNumber(v: unknown): number | null {
  const t = cellText(v);
  if (!t) return null;
  const n = Number(t.replaceAll(",", ""));
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function parseStatus(v: unknown): ImportedCase["status"] | null {
  const t = cellText(v).toUpperCase();
  if (!t) return "OPEN";
  if (t === "OPEN" || t === "TC" || t === "PC" || t === "NA") return t;
  return null;
}

/** 處理單位的寫法:QA、HW/QA、SW、HW,QA → 拆成多個。 */
export function splitUnits(raw: string): string[] {
  return [...new Set(raw.split(/[/,、;\s]+/).map((s) => s.trim().toUpperCase()).filter(Boolean))];
}

const CASE_NO = /^CS(\d{4})(\d{2})(\d{2})-(\d{3,})$/;

/** 匯入的 Case No 要符合格式、日期部分跟發生日期一致;不然就當沒有(匯入時重新產生)。回傳 { caseNo, seq }。 */
export function usableCaseNo(raw: string | null, issueDate: string): { caseNo: string; seq: number } | null {
  if (!raw) return null;
  const m = CASE_NO.exec(raw.trim());
  if (!m) return null;
  if (`${m[1]}-${m[2]}-${m[3]}` !== issueDate) return null;
  return { caseNo: raw.trim(), seq: Number(m[4]) };
}

/**
 * 解析一個工作表。rows 是二維陣列,第一列是標題。沒有「發生日期」與「客戶」標題的工作表(Dashboard、
 * Reliability、零件統計…)標為 recognized = false,整個略過。
 */
export function parseIssueSheet(sheet: string, rows: unknown[][]): ParsedSheet {
  const header = (rows[0] ?? []).map((h) => cellText(h).replace(/\s+/g, " ").trim().toLowerCase());
  const fieldCol = new Map<Field, number>();
  const partCols: number[] = [];
  header.forEach((h, i) => {
    const f = HEADER_ALIASES[h] ?? HEADER_ALIASES[h.replace(/\s+/g, "")];
    if (f && !fieldCol.has(f)) fieldCol.set(f, i);
    if (PART_HEADER.test(h)) partCols.push(i);
  });
  if (!fieldCol.has("issueDate") || !fieldCol.has("customer")) return { sheet, recognized: false, records: [], errors: [] };

  const get = (row: unknown[], f: Field): unknown => {
    const i = fieldCol.get(f);
    return i === undefined ? undefined : row[i];
  };
  const text = (row: unknown[], f: Field) => cellText(get(row, f));
  const records: ImportedCase[] = [];
  const errors: ImportRowError[] = [];

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r] ?? [];
    const where = `${sheet} 第 ${r + 1} 列`;
    const customer = text(row, "customer");
    const description = text(row, "description");
    const rawDate = get(row, "issueDate");
    // 整列空白(Sheet 下面預留的空列)直接略過。
    if (!customer && !description && !cellText(rawDate) && !text(row, "qrCode")) continue;

    const issueDate = parseDate(rawDate);
    if (!issueDate) {
      errors.push({ where, message: `發生日期「${cellText(rawDate)}」無法辨識(要有年份,例如 2026/1/6)` });
      continue;
    }
    const status = parseStatus(get(row, "status"));
    if (!status) {
      errors.push({ where, message: `狀態「${text(row, "status")}」不是 Open / PC / TC / NA` });
      continue;
    }
    const closeRaw = get(row, "closeDate");
    const closeDate = parseDate(closeRaw);
    if (cellText(closeRaw) && !closeDate) {
      errors.push({ where, message: `結案日期「${cellText(closeRaw)}」無法辨識` });
      continue;
    }
    if (closeDate && closeDate < issueDate) {
      errors.push({ where, message: "結案日期早於發生日期" });
      continue;
    }
    const kindText = text(row, "kind").toLowerCase();
    // 2024 版沒有 Repair/Issue 欄,那一年記的都是維修。
    const kind: ImportedCase["kind"] = kindText === "issue" ? "ISSUE" : kindText === "repair" || !fieldCol.has("kind") ? "REPAIR" : "ISSUE";
    const parts = partCols.map((i) => cellText(row[i])).filter(Boolean);
    const warranty = text(row, "warranty").toUpperCase();

    records.push({
      where,
      caseNo: text(row, "caseNo") || null,
      kind,
      customer: customer || null,
      product: text(row, "product") || null,
      region: text(row, "region") || null,
      customerType: text(row, "customerType") || null,
      issueDate,
      serialNo: text(row, "serialNo") || null,
      qrCode: text(row, "qrCode") || null,
      description,
      behavior: text(row, "behavior"),
      warranty: warranty || null,
      status,
      closeDate,
      response: text(row, "response"),
      arrangement: text(row, "arrangement"),
      deckCount: parseNumber(get(row, "deckCount")),
      cutHours: parseNumber(get(row, "cutHours")),
      wheelHours: parseNumber(get(row, "wheelHours")),
      errorType: text(row, "errorType") || null,
      units: splitUnits(text(row, "unit")),
      rma: parseBool(get(row, "rma")),
      rmaCuttingDisk: parseBool(get(row, "rmaCuttingDisk")),
      repairOrderNo: text(row, "repairOrderNo") || null,
      parts,
    });
  }
  return { sheet, recognized: true, records, errors };
}
