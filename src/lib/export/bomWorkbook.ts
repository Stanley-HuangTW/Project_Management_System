import ExcelJS from "exceljs";
import { reconstructBomTree, type BomNode, type IndentedBomLine, type RootedBomLine } from "@/lib/bom";
import type { BomColumnType } from "@/lib/bomColumns";

/**
 * 樣機 BOM 的 Excel 往返。
 *
 * 一個(產品,階段)一個區塊,跟樣機計畫、人力表同一個道理。區塊裡的樹狀
 * 結構用「階層」欄表示,不是隱藏 id——Excel 裡沒有「這列的上層是哪一列」
 * 這種天然的東西,而且新增一整棵子樹時,使用者也不會知道還沒建出來的
 * 上層的資料庫 id。縮排是大家已經會的寫法,階層數字往下一層加一,程式
 * 自己找最近的上一層對回去(reconstructBomTree,在 bom.ts,純函式測過)。
 *
 * 「單價(台幣)」「小計(台幣)」是公式:子集的單價是底下子項目的小計加起來,
 * 寫成公式而不是算好的數字,在 Excel 裡改一顆零件的單價,上面所有祖先的
 * 小計都會跟著動。
 *
 * 看板的自訂欄位接在固定的 12 欄後面(第 13 欄起,標題就是欄位名稱,照看板設定的順序):以前匯出的檔案沒有這幾欄,
 * 照樣匯得進來;匯入時靠標題對欄位,標題對不上的欄略過。
 *
 * 匯入是整個區塊換掉,不是逐列比對:一棵樹的形狀變了(插了一層、搬了
 * 位置),要它去猜哪一列對應哪一列只會猜錯。所以匯入時這個(產品,階段)
 * 原本的 BOM 整個刪掉,照 Excel 裡的內容重建。
 */

export const SHEET_NAME = "BOM";
const BLOCK_PREFIX = "BOM: ";
const COLUMN_HEADERS = [
  "階層",
  "名稱",
  "廠商",
  "型號/料號",
  "數量",
  "單價",
  "幣別",
  "匯率",
  "單價(台幣)",
  "小計(台幣)",
  "備註",
  "交期",
];
/** 固定欄位的數量;自訂欄位從下一欄開始。 */
const FIXED_COLUMNS = COLUMN_HEADERS.length;
const [DEPTH_COL, NAME_COL, VENDOR_COL, PART_COL, QTY_COL, PRICE_COL, CCY_COL, FX_COL, , , NOTE_COL, DELIVERY_COL] =
  COLUMN_HEADERS.map((_, i) => i + 1);

export type BomWorkbookBlock = { product: string; phaseName: string; nodes: BomNode[] };

export type BomWorkbookCustomColumn = { id: string; name: string; type: BomColumnType };

export type BomWorkbookInput = {
  boardName: string;
  blocks: BomWorkbookBlock[];
  /** 看板的自訂欄位,照設定的順序;沒有就只有固定的 12 欄。 */
  customColumns?: BomWorkbookCustomColumn[];
  /** 「人員」欄位寫姓名不寫代號:使用者代號 → 姓名。 */
  userNames?: Map<string, string>;
};

export type ParsedBomBlock = {
  product: string;
  phaseName: string;
  rows: RootedBomLine[];
  /** 這個區塊的欄位標題列裡,第 13 欄起的自訂欄位標題(照欄的順序)。 */
  extraHeaders: string[];
};

export type ParsedBomWorkbook = {
  blocks: ParsedBomBlock[];
  warnings: string[];
};

function numberOf(value: ExcelJS.CellValue): number | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed === "") return null;
    const n = Number(trimmed);
    return Number.isFinite(n) ? n : null;
  }
  if (typeof value === "object" && "result" in value) {
    return numberOf((value as ExcelJS.CellFormulaValue).result as ExcelJS.CellValue);
  }
  return null;
}

function textOf(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number") return String(value);
  if (value instanceof Date) return value.toISOString().slice(0, 10); // 在 Excel 裡手打的日期
  if (typeof value === "object") {
    const v = value as unknown as Record<string, unknown>;
    if (Array.isArray(v.richText)) {
      return (v.richText as { text: string }[]).map((t) => t.text).join("").trim();
    }
    if ("result" in v) return textOf(v.result as ExcelJS.CellValue);
    if ("text" in v) return String(v.text).trim();
  }
  return "";
}

/**
 * 寫一整棵子樹,先序:先寫這一列自己,再遞迴寫子項目;等子項目都寫完,
 * 才回頭補這一列的「單價(台幣)」「小計(台幣)」公式——子集的單價要指到
 * 子項目所在的列號,那些列號要等子項目寫完才知道。
 */
/** 自訂欄位的一格寫進 Excel 的樣子。 */
function customCellValue(column: BomWorkbookCustomColumn, value: unknown, userNames: Map<string, string>): string | number {
  if (value === null || value === undefined || value === false) return "";
  switch (column.type) {
    case "CHECKBOX":
      return value === true ? "是" : "";
    case "PERSON":
      return userNames.get(String(value)) ?? String(value);
    case "NUMBER":
      return typeof value === "number" ? value : String(value);
    default:
      return String(value);
  }
}

function writeNode(
  ws: ExcelJS.Worksheet,
  node: BomNode,
  rowRef: { current: number },
  rowNumberOf: Map<string, number>,
  custom: BomWorkbookCustomColumn[],
  userNames: Map<string, string>
) {
  const row = rowRef.current++;
  rowNumberOf.set(node.id, row);
  const r = ws.getRow(row);
  r.getCell(DEPTH_COL).value = node.depth;
  r.getCell(NAME_COL).value = node.name;
  r.getCell(VENDOR_COL).value = node.vendor;
  r.getCell(PART_COL).value = node.partNumber;
  r.getCell(QTY_COL).value = node.qty;
  r.getCell(CCY_COL).value = node.currency;
  r.getCell(NOTE_COL).value = node.note;
  r.getCell(DELIVERY_COL).value = node.deliveryDate ?? "";
  if (!node.isAssembly) {
    r.getCell(PRICE_COL).value = node.unitPrice;
    r.getCell(FX_COL).value = node.fxRate;
  }
  custom.forEach((column, i) => {
    // 檔案附件欄位:Excel 裡只列檔名(唯讀,檔案要在系統上傳 / 下載)。
    const value = column.type === "FILE" ? (node.files?.[column.id] ?? []).map((f) => f.fileName).join("、") : node.extra?.[column.id];
    r.getCell(FIXED_COLUMNS + 1 + i).value = customCellValue(column, value, userNames);
  });

  for (const child of node.children) writeNode(ws, child, rowRef, rowNumberOf, custom, userNames);

  const priceLetter = ws.getColumn(9).letter; // 單價(台幣)
  const subtotalLetter = ws.getColumn(10).letter; // 小計(台幣)
  if (node.isAssembly) {
    const childRows = node.children.map((c) => rowNumberOf.get(c.id)!);
    r.getCell(9).value = { formula: childRows.map((n) => `${subtotalLetter}${n}`).join("+") || "0" };
  } else {
    r.getCell(9).value = {
      formula: `${ws.getColumn(PRICE_COL).letter}${row}*${ws.getColumn(FX_COL).letter}${row}`,
    };
  }
  r.getCell(10).value = { formula: `${priceLetter}${row}*${ws.getColumn(QTY_COL).letter}${row}` };
}

export async function buildBomWorkbook(input: BomWorkbookInput): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "工作管理平台";
  wb.created = new Date();
  const ws = wb.addWorksheet(SHEET_NAME);

  ws.getColumn(DEPTH_COL).width = 6;
  ws.getColumn(NAME_COL).width = 24;
  ws.getColumn(VENDOR_COL).width = 16;
  ws.getColumn(PART_COL).width = 16;
  ws.getColumn(5).width = 8;
  ws.getColumn(6).width = 10;
  ws.getColumn(7).width = 7;
  ws.getColumn(8).width = 8;
  ws.getColumn(9).width = 12;
  ws.getColumn(10).width = 12;
  ws.getColumn(NOTE_COL).width = 20;
  ws.getColumn(DELIVERY_COL).width = 12;
  const custom = input.customColumns ?? [];
  const userNames = input.userNames ?? new Map<string, string>();
  custom.forEach((_, i) => {
    ws.getColumn(FIXED_COLUMNS + 1 + i).width = 16;
  });

  let r = 1;
  for (const block of input.blocks) {
    const header = ws.getRow(r);
    header.getCell(1).value = `${BLOCK_PREFIX}${block.product}`;
    header.getCell(2).value = block.phaseName;
    header.font = { bold: true };
    r++;

    ws.getRow(r).values = [...COLUMN_HEADERS, ...custom.map((c) => c.name)];
    ws.getRow(r).font = { italic: true, color: { argb: "FF808080" } };
    r++;

    const rowRef = { current: r };
    const rowNumberOf = new Map<string, number>();
    for (const node of block.nodes) writeNode(ws, node, rowRef, rowNumberOf, custom, userNames);
    r = rowRef.current + 1; // 區塊之間留一列空白,純粹排版用,匯入時當區塊結束。
  }

  if (input.blocks.length === 0) {
    ws.getCell(r, 1).value =
      "還沒有任何 BOM。比照下面這行的格式新增一個區塊:第一列 A 欄填「BOM: 產品名稱」," +
      "B 欄填階段名稱(要是這塊看板上真的有的階段,例如 EFS、EVT);下一列是欄位標題,照抄就好;" +
      "階層從 0 開始,子項目的階層要比它的上層多 1。";
    r += 2;
  }

  ws.getCell(r, 1).value =
    "改完存檔,回程式按「匯入 Excel」。匯入時,Excel 裡出現的每一個(產品,階段)區塊會整個" +
    "換掉,不是逐列比對——樹狀結構變了沒辦法逐列比對,所以照 Excel 裡的內容重建整棵樹。";
  ws.getCell(r, 1).font = { italic: true, color: { argb: "FF808080" } };

  // exceljs 帶著自己那份舊的 @types/node,型別上的 Buffer 跟專案的對不起來;
  // 執行期拿到的是真的 Buffer。
  // @ts-expect-error - see comment above
  return (await wb.xlsx.writeBuffer()) as Buffer;
}

export async function parseBomWorkbook(buffer: Buffer): Promise<ParsedBomWorkbook> {
  const wb = new ExcelJS.Workbook();
  // @ts-expect-error - exceljs 的 Buffer 型別衝突
  await wb.xlsx.load(buffer);

  const ws = wb.getWorksheet(SHEET_NAME) ?? wb.worksheets[0];
  if (!ws) throw new Error("這個檔案裡沒有工作表");

  const warnings: string[] = [];
  const blocks: ParsedBomBlock[] = [];
  let current: { product: string; phaseName: string; lines: IndentedBomLine[]; extraCols: { col: number; name: string }[] } | null = null;

  function closeBlock() {
    if (!current) return;
    const { rows, warnings: treeWarnings } = reconstructBomTree(current.lines);
    warnings.push(
      ...treeWarnings.map((w) => `「${current!.product} / ${current!.phaseName}」${w}`)
    );
    blocks.push({ product: current.product, phaseName: current.phaseName, rows, extraHeaders: current.extraCols.map((c) => c.name) });
    current = null;
  }

  for (let r = 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const colA = textOf(row.getCell(1).value);

    if (colA.startsWith(BLOCK_PREFIX)) {
      closeBlock();
      const product = colA.slice(BLOCK_PREFIX.length).trim();
      const phaseName = textOf(row.getCell(2).value);
      if (!product || !phaseName) {
        warnings.push(`第 ${r} 列的區塊表頭缺產品或階段名稱,這個區塊略過。`);
        continue;
      }
      // 下一列是欄位標題:第 13 欄起的標題是自訂欄位。
      const titles = ws.getRow(r + 1);
      const extraCols: { col: number; name: string }[] = [];
      for (let c = FIXED_COLUMNS + 1; c <= Math.max(ws.columnCount, FIXED_COLUMNS); c++) {
        const name = textOf(titles.getCell(c).value);
        if (name) extraCols.push({ col: c, name });
      }
      current = { product, phaseName, lines: [], extraCols };
      r++; // 標題列不是資料,跳過。
      continue;
    }

    if (colA === "") {
      // 完全空白的一列結束目前的區塊——樹的階層要連續,跳過一列之後沒辦法
      // 安全地接著猜下去,不像人力表、樣機計畫那種平的清單可以直接略過。
      closeBlock();
      continue;
    }

    if (!current) continue; // 還沒進到任何區塊的雜訊列,略過。

    const depth = numberOf(row.getCell(DEPTH_COL).value);
    const name = textOf(row.getCell(NAME_COL).value);
    if (depth === null || name === "") {
      warnings.push(`「${current.product} / ${current.phaseName}」第 ${r} 列讀不出階層或名稱,這一列略過。`);
      continue;
    }

    const qty = numberOf(row.getCell(QTY_COL).value) ?? 0;
    if (!Number.isFinite(qty) || qty <= 0) {
      warnings.push(`「${current.product} / ${current.phaseName}」的「${name}」數量必須大於 0,這一列略過。`);
      continue;
    }
    const unitPrice = numberOf(row.getCell(PRICE_COL).value) ?? 0;
    if (unitPrice < 0) {
      warnings.push(`「${current.product} / ${current.phaseName}」的「${name}」單價不可為負,這一列略過。`);
      continue;
    }
    const currency = textOf(row.getCell(CCY_COL).value).toUpperCase() || "TWD";
    if (!/^[A-Z]{3}$/.test(currency)) {
      warnings.push(`「${current.product} / ${current.phaseName}」的「${name}」幣別看不懂,這一列略過。`);
      continue;
    }
    const fxRate = currency === "TWD" ? 1 : (numberOf(row.getCell(FX_COL).value) ?? 0);
    if (fxRate <= 0) {
      warnings.push(`「${current.product} / ${current.phaseName}」的「${name}」匯率必須大於 0,這一列略過。`);
      continue;
    }

    current.lines.push({
      depth,
      name,
      vendor: textOf(row.getCell(VENDOR_COL).value),
      partNumber: textOf(row.getCell(PART_COL).value),
      qty,
      unitPrice,
      currency,
      fxRate,
      note: textOf(row.getCell(NOTE_COL).value),
      deliveryDate: textOf(row.getCell(DELIVERY_COL).value) || null,
      ...(current.extraCols.length > 0
        ? { extra: Object.fromEntries(current.extraCols.map((c) => [c.name, textOf(row.getCell(c.col).value)])) }
        : {}),
    });
  }
  closeBlock();

  if (blocks.length === 0) {
    throw new Error(
      `找不到任何「${BLOCK_PREFIX}」開頭的區塊表頭。請用程式匯出的檔案來改,不要自己新建一份。`
    );
  }

  return { blocks, warnings };
}
