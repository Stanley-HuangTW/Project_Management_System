import ExcelJS from "exceljs";
import { NRE_CATEGORIES, NRE_CATEGORY_GUIDE, NRE_LABELS, resolveNreAmount, type NreCategoryKey } from "@/lib/nre";

/**
 * NRE 報價單的 Excel 匯出。
 *
 * 版面照畫面與報價單的慣例:每一類一個區塊——區塊表頭(類別名稱加欄位名稱,研發人力的欄位是工時與時薪)、
 * 逐列明細、一列小計;最後是 NRE 總計。數量乘單價的金額與各小計、總計都是公式(並附上算好的值,
 * 沒有重算的檢視器也看得到數字),在 Excel 裡改數量或單價,金額會跟著變。
 * 沒有任何項目的類別整塊省略,報價單上不放空白的區塊。
 */

export const NRE_SHEET_NAME = "NRE 報價單";

export type NreWorkbookLine = {
  category: NreCategoryKey;
  description: string;
  basis: string;
  vendor: string;
  quantity: number | null;
  unitPrice: number | null;
  amount: number;
  note: string;
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
const COLUMNS = 8;
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
  [16, 34, 26, 22, 12, 14, 16, 30].forEach((width, i) => (ws.getColumn(i + 1).width = width));

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
    const labels = [NRE_LABELS[category], "細項說明", "估算基礎", guide.vendorLabel, guide.quantityLabel, guide.unitPriceLabel, "金額(元)", "備註"];
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
