/**
 * 從 Excel / Google 試算表複製一欄、一列或一塊儲存格,貼到 BOM 表格上「更新現有的列」——純邏輯,不碰資料庫與畫面。
 *
 * 跟「貼成新的列」(bomPaste.ts)不同:這裡是改已經存在的格子。像 Excel 一樣從框選(或游標所在)的左上角那一格開始,
 * 貼上的內容由上而下、由左而右一格對一格;只貼一個值,框選的每一格都填同一個值。
 * 貼上的欄對應的是表格上「看得到的資料欄」(名稱、廠商、型號/料號、數量、單價、幣別、匯率、交期、備註、自訂欄位),
 * 小計、BOM LEVEL、檔案附件不是資料格,不在對應的欄裡。
 */
import { leadTimeOf, numberOf } from "@/lib/bomPaste";
import { importCellValue, isCustomColumn, type BomCellValue, type BomColumnDef, type ImportUser } from "@/lib/bomColumns";

export const MAX_PASTE_ROWS = 300;
export const MAX_PASTE_CELLS = 3000;
const LIMITS = { name: 200, vendor: 100, partNumber: 100, note: 500 } as const;

/** 表格上固定欄位的代號(內建欄位 vendor / partNumber / delivery / note 沿用設定裡的代號,自訂欄位是 c_ 開頭的代號)。 */
export const FIXED_LABELS: Record<string, string> = {
  name: "名稱",
  qty: "數量",
  unitPrice: "單價",
  currency: "幣別",
  fxRate: "匯率",
};

/** 一欄叫什麼名字(看板設定過的名字優先),說明文字用。 */
export function labelOfKey(colKey: string, columns: BomColumnDef[]): string {
  return FIXED_LABELS[colKey] ?? columns.find((c) => c.id === colKey)?.name ?? colKey;
}

export type CellSelection = { rowIds: string[]; colKeys: string[] };
export type PlacedCell = { rowId: string; colKey: string; text: string };

/**
 * 把貼上的那一塊(grid)放到表格的格子上。
 * - 只貼一個值(1×1)而且框選了好幾格:框選的每一格都填同一個值。
 * - 其他:從框選的左上角那一格開始,一格對一格;超出表格最後一列、最右一欄的部分不貼,回報被略過幾列 / 幾欄。
 * rowOrder / colOrder 是畫面上看得到的列與資料欄的順序。
 */
export function placeBlock(
  grid: string[][],
  rowOrder: string[],
  colOrder: string[],
  selection: CellSelection
): { cells: PlacedCell[]; clippedRows: number; clippedCols: number } | { error: string } {
  if (grid.length === 0) return { error: "沒有內容可以貼上" };
  if (grid.length > MAX_PASTE_ROWS) return { error: `一次最多貼上 ${MAX_PASTE_ROWS} 列(你貼了 ${grid.length} 列),請分幾次貼。` };
  const row0 = rowOrder.indexOf(selection.rowIds[0]);
  const col0 = colOrder.indexOf(selection.colKeys[0]);
  if (row0 < 0 || col0 < 0) return { error: "找不到要貼上的位置,請重新框選" };

  const cells: PlacedCell[] = [];
  if (grid.length === 1 && grid[0].length === 1 && selection.rowIds.length * selection.colKeys.length > 1) {
    for (const rowId of selection.rowIds) for (const colKey of selection.colKeys) cells.push({ rowId, colKey, text: grid[0][0] });
    return { cells, clippedRows: 0, clippedCols: 0 };
  }

  let clippedRows = 0;
  let clippedCols = 0;
  for (let i = 0; i < grid.length; i++) {
    const rowIdx = row0 + i;
    if (rowIdx >= rowOrder.length) {
      clippedRows = grid.length - i;
      break;
    }
    for (let j = 0; j < grid[i].length; j++) {
      const colIdx = col0 + j;
      if (colIdx >= colOrder.length) {
        clippedCols = Math.max(clippedCols, grid[i].length - j);
        break;
      }
      cells.push({ rowId: rowOrder[rowIdx], colKey: colOrder[colIdx], text: grid[i][j] });
    }
  }
  if (cells.length > MAX_PASTE_CELLS) return { error: `一次最多貼上 ${MAX_PASTE_CELLS} 格(你貼了 ${cells.length} 格),請分幾次貼。` };
  return { cells, clippedRows, clippedCols };
}

/** 一列現在的樣子(轉換時要用:有子項目的列單價不能貼、台幣不需要匯率)。 */
export type RowFacts = { isAssembly: boolean; currency: string; fxRate: number };

export type FieldChange =
  | { field: "name" | "vendor" | "partNumber" | "note"; value: string }
  | { field: "deliveryDate"; value: string | null }
  | { field: "qty" | "unitPrice" | "fxRate"; value: number }
  | { field: "currency"; value: string }
  | { field: "extra"; columnId: string; value: BomCellValue };

/** change = 可以貼;skip = 空白格,這格維持原樣(不是錯);problem = 轉不過去,說明原因。 */
export type Converted = { change: FieldChange } | { skip: string } | { problem: string };

/** 一格貼上的文字,依這一欄的類型轉成要存的值。 */
export function convertPastedCell(
  colKey: string,
  text: string,
  ctx: { columns: BomColumnDef[]; users: ImportUser[]; row: RowFacts }
): Converted {
  const raw = text.trim();
  const label = labelOfKey(colKey, ctx.columns);
  const blank = raw === "";
  const tooLong = (n: number) => ({ problem: `「${label}」太長了(上限 ${n} 字)` });

  switch (colKey) {
    case "name":
      if (blank) return { skip: label };
      return raw.length > LIMITS.name ? tooLong(LIMITS.name) : { change: { field: "name", value: raw } };
    case "vendor":
    case "partNumber":
    case "note":
      return raw.length > LIMITS[colKey] ? tooLong(LIMITS[colKey]) : { change: { field: colKey, value: raw } };
    case "delivery": {
      const weeks = leadTimeOf(raw);
      return weeks === undefined ? { problem: `「${label}」要填週數(例如 8)` } : { change: { field: "deliveryDate", value: weeks } };
    }
    case "qty": {
      if (blank) return { skip: label };
      const n = numberOf(raw);
      return n === null || !Number.isFinite(n) || n <= 0 ? { problem: `「${label}」要是大於 0 的數字` } : { change: { field: "qty", value: n } };
    }
    case "unitPrice": {
      if (ctx.row.isAssembly) return { problem: `有子項目,「${label}」是底下加總算出來的` };
      if (blank) return { skip: label };
      const n = numberOf(raw);
      return n === null || !Number.isFinite(n) || n < 0 ? { problem: `「${label}」要是 0 或正數` } : { change: { field: "unitPrice", value: n } };
    }
    case "currency": {
      if (ctx.row.isAssembly) return { problem: `有子項目,「${label}」不用填` };
      if (blank) return { skip: label };
      const code = raw.toUpperCase();
      return /^[A-Z]{3}$/.test(code) ? { change: { field: "currency", value: code } } : { problem: `「${label}」請填三個英文字母(例如 USD)` };
    }
    case "fxRate": {
      if (ctx.row.isAssembly) return { problem: `有子項目,「${label}」不用填` };
      if (blank) return { skip: label };
      const n = numberOf(raw);
      return n === null || !Number.isFinite(n) || n <= 0 ? { problem: `「${label}」要是大於 0 的數字` } : { change: { field: "fxRate", value: n } };
    }
  }

  const column = ctx.columns.find((c) => c.id === colKey);
  if (!column || !isCustomColumn(column)) return { problem: `「${label}」不能貼上` };
  if (column.type === "FILE") return { problem: `「${label}」是檔案附件,要到那一列上傳` };
  const checked = importCellValue(column, raw, ctx.users);
  return "error" in checked ? { problem: checked.error } : { change: { field: "extra", columnId: column.id, value: checked.value } };
}

export type RowUpdate = {
  data: {
    name?: string;
    vendor?: string;
    partNumber?: string;
    note?: string;
    deliveryDate?: string | null;
    qty?: number;
    unitPrice?: number;
    currency?: string;
    fxRate?: number;
  };
  /** 要合進這一列自訂欄位的值(欄位代號 → 值);沒有就是 null。 */
  extra: Record<string, BomCellValue> | null;
  problems: string[];
};

/**
 * 一列要改的幾格合成一次更新。幣別與匯率互相牽動:改成台幣,匯率一律是 1;改成外幣,匯率用貼上的、
 * 原本就是同一個外幣的沿用原本的、再沒有就用系統設定裡目前的匯率(rateOf),都沒有就整個幣別不改並說明。
 */
export function buildRowUpdate(row: RowFacts, changes: FieldChange[], rateOf: (code: string) => number | null): RowUpdate {
  const out: RowUpdate = { data: {}, extra: null, problems: [] };
  let pastedCurrency: string | undefined;
  let pastedFx: number | undefined;
  for (const change of changes) {
    switch (change.field) {
      case "currency":
        pastedCurrency = change.value;
        break;
      case "fxRate":
        pastedFx = change.value;
        break;
      case "extra":
        (out.extra ??= {})[change.columnId] = change.value;
        break;
      case "deliveryDate":
        out.data.deliveryDate = change.value;
        break;
      default:
        out.data[change.field] = change.value as never;
    }
  }

  if (pastedCurrency !== undefined || pastedFx !== undefined) {
    const next = pastedCurrency ?? row.currency;
    if (next === "TWD") {
      if (pastedCurrency === undefined) out.problems.push("台幣不需要匯率,匯率沒有更新");
      else {
        out.data.currency = "TWD";
        out.data.fxRate = 1;
      }
    } else {
      const fx = pastedFx ?? (next === row.currency && row.currency !== "TWD" ? row.fxRate : rateOf(next));
      if (fx === null || fx === undefined) out.problems.push(`「${next}」沒有匯率(貼上的內容沒有、系統設定裡也沒有這個幣別的匯率),幣別沒有更新`);
      else {
        if (pastedCurrency !== undefined) out.data.currency = next;
        out.data.fxRate = fx;
      }
    }
  }
  return out;
}
