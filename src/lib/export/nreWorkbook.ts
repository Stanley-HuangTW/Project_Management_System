import ExcelJS from "exceljs";
import { xlsxProblem } from "@/lib/xlsxGuard";
import {
  NRE_CATEGORIES,
  NRE_CATEGORY_GUIDE,
  NRE_LABELS,
  resolveNreAmount,
  validateNreLine,
  type NreCategoryKey,
  type NreLineInput,
} from "@/lib/nre";
import { isValidIsoDate } from "@/lib/timesheet";

/**
 * NRE 報價單的 Excel 匯出。
 *
 * 版面照畫面與報價單的慣例:每一類一個區塊——區塊表頭(類別名稱加欄位名稱,研發人力的欄位是工時與時薪)、
 * 逐列明細、一列小計;最後是 NRE 總計。數量乘單價的金額與各小計、總計都是公式(並附上算好的值,
 * 沒有重算的檢視器也看得到數字),在 Excel 裡改數量或單價,金額會跟著變。
 * 沒有任何項目的類別整塊省略,報價單上不放空白的區塊。
 *
 * 「委託開發」的區塊多三欄:開始日、結束日(時間範圍)與範圍(階段的名字,或「整個專案」),表頭的第二格是「委託項目」、
 * 廠商那一欄是「委託單位」。
 *
 * 匯入讀的就是這個版面(parseNreWorkbook):靠每個區塊表頭那一列(第一格是類別名稱、同一列裡有「細項說明」或「委託項目」)
 * 認出「從這裡開始是哪一類」,欄位照表頭的文字找,所以欄位順序變了也讀得到。
 */

export const NRE_SHEET_NAME = "NRE 報價單";

export type NreWorkbookLine = Omit<NreLineInput, "phaseId"> & {
  /** 範圍:階段的名字或「整個專案」。只有委託開發會寫進 Excel。 */
  scope: string;
};

export type NreWorkbookInput = {
  boardName: string;
  phaseName: string;
  /** 匯出日期 "YYYY-MM-DD"(台灣時間)。 */
  exportedOn: string;
  lines: NreWorkbookLine[];
};

const MONEY_FORMAT = "#,##0";
const QUANTITY_FORMAT = "#,##0.##";
/** 一般的區塊 8 欄;有委託開發時再多 3 欄(開始日、結束日、範圍)。 */
const BASE_COLUMNS = 8;
const COMMISSIONED_COLUMNS = 11;
const HEADER_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8EEF7" } };
const THIN: Partial<ExcelJS.Borders> = {
  top: { style: "thin", color: { argb: "FFB5BCC8" } },
  bottom: { style: "thin", color: { argb: "FFB5BCC8" } },
};

export async function buildNreWorkbook(input: NreWorkbookInput): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "工作管理平台";
  wb.created = new Date();
  const ws = wb.addWorksheet(NRE_SHEET_NAME, {
    pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 },
  });
  [16, 34, 26, 22, 12, 14, 16, 30, 13, 13, 16].forEach((width, i) => (ws.getColumn(i + 1).width = width));
  const COLUMNS = input.lines.some((l) => l.category === "COMMISSIONED") ? COMMISSIONED_COLUMNS : BASE_COLUMNS;

  ws.mergeCells(1, 1, 1, COLUMNS);
  const title = ws.getCell(1, 1);
  title.value = `${input.boardName} ${input.phaseName} NRE 報價單`;
  title.font = { bold: true, size: 14 };
  ws.mergeCells(2, 1, 2, COLUMNS);
  const subtitle = ws.getCell(2, 1);
  subtitle.value = `匯出日期 ${input.exportedOn}・金額單位:新台幣(元)・NRE 為量產前的一次性工程費用,與產品單價分開計費`;
  subtitle.font = { size: 9, color: { argb: "FF6B7280" } };

  let r = 4;
  const subtotalCells: string[] = [];
  let grandTotal = 0;

  for (const category of NRE_CATEGORIES) {
    const lines = input.lines.filter((l) => l.category === category);
    if (lines.length === 0) continue;
    const guide = NRE_CATEGORY_GUIDE[category];

    const header = ws.getRow(r);
    const labels = [NRE_LABELS[category], guide.descriptionLabel, "估算基礎", guide.vendorLabel, guide.quantityLabel, guide.unitPriceLabel, "金額(元)", "備註"];
    if (category === "COMMISSIONED") labels.push("開始日", "結束日", "範圍");
    labels.forEach((text, i) => {
      const cell = header.getCell(i + 1);
      cell.value = text;
      cell.font = { bold: true };
      cell.fill = HEADER_FILL;
      cell.border = THIN;
      cell.alignment = { horizontal: i >= 4 && i <= 6 ? "right" : "left", vertical: "middle", wrapText: true };
    });
    r++;

    const first = r;
    for (const line of lines) {
      const row = ws.getRow(r);
      row.getCell(2).value = line.description;
      row.getCell(3).value = line.basis || null;
      row.getCell(4).value = line.vendor || null;
      if (line.quantity !== null) {
        row.getCell(5).value = line.quantity;
        row.getCell(5).numFmt = QUANTITY_FORMAT;
      }
      if (line.unitPrice !== null) {
        row.getCell(6).value = line.unitPrice;
        row.getCell(6).numFmt = MONEY_FORMAT;
      }
      const amount = resolveNreAmount(line);
      // 數量與單價都有就是公式(跟畫面的規則一致:數量 > 0、單價 ≥ 0),否則金額就是填的那個數字。
      const computed = line.quantity !== null && line.unitPrice !== null && line.quantity > 0 && line.unitPrice >= 0;
      row.getCell(7).value = computed ? { formula: `ROUND(E${r}*F${r},0)`, result: amount } : amount;
      row.getCell(7).numFmt = MONEY_FORMAT;
      row.getCell(8).value = line.note || null;
      if (category === "COMMISSIONED") {
        // 日期寫成文字("2026-10-08"):不受 Excel 的日期格式與時區影響;在 Excel 裡改成真正的日期格式也讀得回來。
        row.getCell(9).value = line.startDate;
        row.getCell(10).value = line.endDate;
        row.getCell(11).value = line.scope || null;
      }
      for (let c = 2; c <= COLUMNS; c++) row.getCell(c).alignment = { vertical: "top", wrapText: c === 2 || c === 3 || c === 8 };
      row.getCell(1).alignment = { vertical: "top" };
      grandTotal += amount;
      r++;
    }
    const last = r - 1;
    const subtotal = lines.reduce((sum, l) => sum + resolveNreAmount(l), 0);

    const sub = ws.getRow(r);
    sub.getCell(1).value = "小計";
    sub.getCell(7).value = { formula: `SUM(G${first}:G${last})`, result: subtotal };
    sub.getCell(7).numFmt = MONEY_FORMAT;
    sub.font = { bold: true };
    for (let c = 1; c <= COLUMNS; c++) sub.getCell(c).border = { top: { style: "thin" } };
    subtotalCells.push(`G${r}`);
    r += 2;
  }

  const total = ws.getRow(r);
  total.getCell(1).value = "NRE 總計";
  total.getCell(7).value =
    subtotalCells.length > 0 ? { formula: `SUM(${subtotalCells.join(",")})`, result: grandTotal } : 0;
  total.getCell(7).numFmt = MONEY_FORMAT;
  total.font = { bold: true, size: 12 };
  for (let c = 1; c <= COLUMNS; c++) total.getCell(c).border = { top: { style: "thin" }, bottom: { style: "double" } };

  return Buffer.from(await wb.xlsx.writeBuffer());
}

// ---------------------------------------------------------------- 匯入

export type ParsedNreLine = Omit<NreLineInput, "phaseId"> & {
  /** 在 Excel 的第幾列,警告訊息用。 */
  row: number;
  /** 範圍欄寫的字(階段的名字或「整個專案」);只有委託開發會讀,沒寫是空字串,由呼叫端決定對應到哪個階段。 */
  scope: string;
};

export type ParsedNreWorkbook = {
  lines: ParsedNreLine[];
  /** 讀不進來的列(沒有細項說明、數字不是數字、欄位太長…)——整列略過,原因在這裡。 */
  warnings: string[];
  error?: string;
};

function textOf(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number") return String(value);
  if (typeof value === "object") {
    const v = value as unknown as Record<string, unknown>;
    if (Array.isArray(v.richText)) return (v.richText as { text: string }[]).map((t) => t.text).join("").trim();
    if ("result" in v) return textOf(v.result as ExcelJS.CellValue);
    if ("text" in v) return String(v.text).trim();
  }
  return "";
}

/** 空白是 null;數字(含公式算出來的值、「1,250」這種文字)回數字;其他回 NaN。 */
function numberOf(value: ExcelJS.CellValue): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return value;
  const text = textOf(value).replace(/[,\s]/g, "");
  if (text === "") return null;
  return Number(text);
}

/**
 * 日期格:空白是 null;"2026-10-08"(也收 "2026/10/8")與 Excel 真正的日期格式都轉成 "YYYY-MM-DD";
 * 認不得的回 undefined。Excel 的日期格 ExcelJS 讀成 UTC 午夜的 Date,取 UTC 的年月日才不會差一天。
 */
function dateOf(value: ExcelJS.CellValue): string | null | undefined {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? undefined : value.toISOString().slice(0, 10);
  const text = textOf(value);
  if (text === "") return null;
  const m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(text);
  if (!m) return undefined;
  const iso = `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  return isValidIsoDate(iso) ? iso : undefined;
}

type ColumnMap = {
  description: number;
  basis: number;
  vendor: number;
  quantity: number;
  unitPrice: number;
  amount: number;
  note: number;
  startDate: number;
  endDate: number;
  scope: number;
};

const DESCRIPTION_LABELS = new Set(Object.values(NRE_CATEGORY_GUIDE).map((g) => g.descriptionLabel));

/** 區塊表頭那一列:照文字找每個欄位在第幾欄,找不到的用匯出的預設位置。 */
function mapColumns(row: ExcelJS.Row): ColumnMap {
  const cols: ColumnMap = { description: 2, basis: 3, vendor: 4, quantity: 5, unitPrice: 6, amount: 7, note: 8, startDate: 9, endDate: 10, scope: 11 };
  const vendorLabels = new Set(Object.values(NRE_CATEGORY_GUIDE).map((g) => g.vendorLabel));
  for (let c = 2; c <= 20; c++) {
    const text = textOf(row.getCell(c).value);
    if (!text) continue;
    if (DESCRIPTION_LABELS.has(text)) cols.description = c;
    else if (text === "開始日") cols.startDate = c;
    else if (text === "結束日") cols.endDate = c;
    else if (text === "範圍") cols.scope = c;
    else if (text === "估算基礎") cols.basis = c;
    else if (vendorLabels.has(text)) cols.vendor = c;
    else if (text.startsWith("金額")) cols.amount = c;
    else if (text === "備註") cols.note = c;
    else if (text === "數量" || text.includes("工時")) cols.quantity = c;
    else if (text.includes("單價") || text.includes("時薪")) cols.unitPrice = c;
  }
  return cols;
}

/**
 * 讀回報價單 Excel(匯出的版面,或照那個版面手動做的)。
 *
 * 區塊表頭那一列(第一格是類別名稱,例如「模具與治具」,同一列裡有「細項說明」,委託開發是「委託項目」)開始一個類別,
 * 底下每一列有細項說明的就是一筆,到「小計」或「NRE 總計」那一列為止。委託開發另外讀開始日、結束日與範圍。數量與單價都有就以相乘為準
 * (跟畫面的規則一樣),否則讀金額那一格(公式讀它算好的值)。有問題的列整列略過並說明原因,
 * 不會因為一列壞掉就整份讀不進來。
 */
export async function parseNreWorkbook(data: Buffer): Promise<ParsedNreWorkbook> {
  const unsafe = await xlsxProblem(data); // 壓縮炸彈:先擋,不要讓 exceljs 去解壓縮
  if (unsafe) return { lines: [], warnings: [], error: unsafe };
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(data as unknown as ArrayBuffer);
  } catch {
    return { lines: [], warnings: [], error: "這不是有效的 Excel 檔案(.xlsx),請用匯出的報價單檔案改好之後再匯入。" };
  }
  const ws = wb.getWorksheet(NRE_SHEET_NAME) ?? wb.worksheets[0];
  if (!ws) return { lines: [], warnings: [], error: "這份 Excel 裡沒有工作表。" };

  const categoryOfLabel = new Map<string, NreCategoryKey>(NRE_CATEGORIES.map((c) => [NRE_LABELS[c], c]));
  const lines: ParsedNreLine[] = [];
  const warnings: string[] = [];
  let current: { category: NreCategoryKey; cols: ColumnMap } | null = null;

  ws.eachRow((row, rowNumber) => {
    const first = textOf(row.getCell(1).value);
    const category = categoryOfLabel.get(first);
    if (category && Array.from({ length: 12 }, (_, i) => textOf(row.getCell(i + 2).value)).some((t) => DESCRIPTION_LABELS.has(t))) {
      current = { category, cols: mapColumns(row) };
      return;
    }
    if (first === "小計" || first.startsWith("NRE 總計")) {
      current = null;
      return;
    }
    if (!current) return;

    const { cols } = current;
    const description = textOf(row.getCell(cols.description).value);
    const quantity = numberOf(row.getCell(cols.quantity).value);
    const unitPrice = numberOf(row.getCell(cols.unitPrice).value);
    const amount = numberOf(row.getCell(cols.amount).value);
    const basis = textOf(row.getCell(cols.basis).value);
    const vendor = textOf(row.getCell(cols.vendor).value);
    const note = textOf(row.getCell(cols.note).value);
    // 時間範圍與範圍只有委託開發有;別類的區塊就算多了這幾欄也不讀。
    const commissioned = current.category === "COMMISSIONED";
    const startDate = commissioned ? dateOf(row.getCell(cols.startDate).value) : null;
    const endDate = commissioned ? dateOf(row.getCell(cols.endDate).value) : null;
    const scope = commissioned ? textOf(row.getCell(cols.scope).value) : "";
    const label = NRE_CATEGORY_GUIDE[current.category].descriptionLabel;

    if (description === "") {
      // 完全空白的列(排版用)不提;有別的內容卻沒有細項說明才要說。
      if ([basis, vendor, note, scope].some((t) => t !== "") || [quantity, unitPrice, amount, startDate, endDate].some((n) => n !== null)) {
        warnings.push(`第 ${rowNumber} 列沒有${label},略過。`);
      }
      return;
    }
    for (const [what, n] of [["數量", quantity], ["單價", unitPrice], ["金額", amount]] as const) {
      if (n !== null && !Number.isFinite(n)) {
        warnings.push(`第 ${rowNumber} 列「${description}」的${what}不是數字,略過。`);
        return;
      }
    }
    for (const [what, d] of [["開始日", startDate], ["結束日", endDate]] as const) {
      if (d === undefined) {
        warnings.push(`第 ${rowNumber} 列「${description}」的${what}不是日期(請用 2026-10-08 的格式),略過。`);
        return;
      }
    }
    const input = {
      category: current.category,
      startDate: startDate ?? null,
      endDate: endDate ?? null,
      description,
      basis,
      vendor,
      quantity,
      unitPrice,
      amount: amount ?? 0,
      note,
    };
    // 範圍對應到哪個階段由呼叫端決定;這裡驗證的只有跟階段無關的規則,所以給一個不是 null 的代號。
    const invalid = validateNreLine({ ...input, phaseId: "-" });
    if (invalid) {
      warnings.push(`第 ${rowNumber} 列「${description}」:${invalid},略過。`);
      return;
    }
    lines.push({ ...input, scope, row: rowNumber });
  });

  return { lines, warnings };
}
