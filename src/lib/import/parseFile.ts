import ExcelJS from "exceljs";
import { assertSafeXlsx } from "@/lib/xlsxGuard";
import { parse as parseCsvSync } from "csv-parse/sync";

export const MAX_IMPORT_ROWS = 2000;
export const MAX_IMPORT_COLS = 40;

export type ParsedSheet = {
  name: string;
  rows: (string | null)[][];
};

export type ParsedWorkbook = {
  sheets: ParsedSheet[];
};

export async function parseWorkbookBuffer(
  buffer: Buffer,
  filename: string
): Promise<ParsedWorkbook> {
  const ext = filename.toLowerCase().split(".").pop();

  if (ext === "csv") {
    return { sheets: [parseCsv(buffer)] };
  }

  if (ext === "xlsx" || ext === "xls") {
    return parseExcel(buffer);
  }

  throw new Error("不支援的檔案格式,請上傳 .csv、.xlsx 或 .xls 檔案");
}

function parseCsv(buffer: Buffer): ParsedSheet {
  const text = buffer.toString("utf-8");
  const records = parseCsvSync(text, {
    relax_column_count: true,
    skip_empty_lines: false,
  }) as string[][];

  const rows = records
    .slice(0, MAX_IMPORT_ROWS)
    .map((row) =>
      row.slice(0, MAX_IMPORT_COLS).map((cell) => (cell === "" ? null : cell))
    );

  return { name: "CSV", rows };
}

async function parseExcel(buffer: Buffer): Promise<ParsedWorkbook> {
  await assertSafeXlsx(buffer); // 壓縮炸彈:先擋,不要讓 exceljs 去解壓縮
  const workbook = new ExcelJS.Workbook();
  // exceljs depends on fast-csv, which bundles its own old @types/node,
  // producing two incompatible global `Buffer` types during type-checking.
  // Runtime value is a real Buffer; this is a type-only conflict.
  // @ts-expect-error - see comment above
  await workbook.xlsx.load(buffer);

  const sheets: ParsedSheet[] = workbook.worksheets.map((sheet) => {
    const rowCount = Math.min(sheet.rowCount, MAX_IMPORT_ROWS);
    const colCount = Math.min(sheet.columnCount, MAX_IMPORT_COLS);
    const rows: (string | null)[][] = [];

    for (let r = 1; r <= rowCount; r++) {
      const row = sheet.getRow(r);
      const values: (string | null)[] = [];
      for (let c = 1; c <= colCount; c++) {
        values.push(normalizeCellValue(row.getCell(c).value));
      }
      rows.push(values);
    }

    return { name: sheet.name, rows };
  });

  return { sheets };
}

function normalizeCellValue(value: ExcelJS.CellValue): string | null {
  if (value === null || value === undefined) return null;

  if (value instanceof Date) return formatDate(value);

  if (typeof value === "object") {
    if ("richText" in value && Array.isArray(value.richText)) {
      return value.richText.map((t) => t.text).join("");
    }
    if ("result" in value) {
      return normalizeCellValue(value.result as ExcelJS.CellValue);
    }
    if ("text" in value) {
      return String(value.text);
    }
    if ("error" in value) {
      return null;
    }
    return null;
  }

  return String(value);
}

function formatDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
