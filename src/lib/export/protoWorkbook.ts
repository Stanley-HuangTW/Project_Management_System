import ExcelJS from "exceljs";
import type { ProtoSummary } from "@/lib/protoPlan";
import type { Comment } from "exceljs";

/**
 * 樣機計畫的 Excel 往返。
 *
 * 比照那張「M3專案費用預估」的 Proto 分頁:一個產品一個區塊,區塊自己的
 * 表頭就是「{產品} Proto Plan」接著各階段名稱,底下一列一個用途單位,
 * 最後一列小計。使用者已經看慣這個排法,匯出去長一樣,改完才不用重新
 * 學一次格式。
 *
 * 沒有隱藏的 ID 欄——一格的身分是「產品 + 用途單位 + 階段」,這組合本來
 * 就是資料庫的唯一鍵(ProtoPlan 的 @@unique),讀名字就夠了,不用另外
 * 發一個 ID。區塊怎麼分靠表頭那一列的「... Proto Plan」字樣,不是空白列——
 * 空白列只當成排版用的分隔,人力表那邊已經因為這個理由改過一次。
 */

export const SHEET_NAME = "Proto";
const BLOCK_HEADER_SUFFIX = " Proto Plan";
const SUBTOTAL_LABEL = "小計";

export type ProtoWorkbookInput = {
  boardName: string;
  phases: { id: string; name: string }[];
  summary: ProtoSummary;
};

/** 匯入讀出來的一格。qty 是整數台數,note 是選填的備註(存成 Excel 的儲存格註解)。 */
export type ParsedProtoCell = {
  product: string;
  unit: string;
  phaseName: string;
  qty: number;
  note: string;
};

export type ParsedProtoWorkbook = {
  cells: ParsedProtoCell[];
  warnings: string[];
};

function noteOf(value: string | Comment | undefined): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value.trim();
  // exceljs 有時候把 note 讀成 { texts: [...] } 這種富文字結構,不是純字串。
  const v = value as unknown as { texts?: { text: string }[] };
  if (Array.isArray(v.texts)) return v.texts.map((t) => t.text).join("").trim();
  return "";
}

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

export async function buildProtoWorkbook(input: ProtoWorkbookInput): Promise<Buffer> {
  const { phases, summary } = input;

  const wb = new ExcelJS.Workbook();
  wb.creator = "工作管理平台";
  wb.created = new Date();
  const ws = wb.addWorksheet(SHEET_NAME);

  ws.getColumn(1).width = 32;
  for (let c = 2; c <= phases.length + 1; c++) ws.getColumn(c).width = 10;
  const letter = (col: number) => ws.getColumn(col).letter;

  let r = 1;
  for (const product of summary.products) {
    // 區塊表頭:「{產品} Proto Plan」接著這塊看板的各階段名稱 —— 匯入時
    // 靠這一列的第一格認出「新的一個產品區塊從這裡開始」。
    const header = ws.getRow(r);
    header.getCell(1).value = `${product.product}${BLOCK_HEADER_SUFFIX}`;
    phases.forEach((phase, i) => (header.getCell(2 + i).value = phase.name));
    header.font = { bold: true };
    r++;

    const firstUnitRow = r;
    for (const row of product.rows) {
      const line = ws.getRow(r);
      line.getCell(1).value = row.unit;
      row.cells.forEach((cell, i) => {
        if (cell.qty !== 0) line.getCell(2 + i).value = cell.qty;
        if (cell.note) line.getCell(2 + i).note = cell.note;
      });
      r++;
    }
    const lastUnitRow = r - 1;

    // 小計:公式,而且只在真的有用途單位列的時候才寫,不然 SUM 的範圍會
    // 往上吃到表頭那一列。
    if (lastUnitRow >= firstUnitRow) {
      const sub = ws.getRow(r);
      sub.getCell(1).value = SUBTOTAL_LABEL;
      phases.forEach((_, i) => {
        const col = letter(2 + i);
        sub.getCell(2 + i).value = { formula: `SUM(${col}${firstUnitRow}:${col}${lastUnitRow})` };
      });
      sub.font = { bold: true };
      r++;
    }

    r++; // 區塊之間留一列空白,純粹排版用,匯入時當分隔略過。
  }

  if (summary.products.length === 0) {
    ws.getCell(1, 1).value =
      "還沒有樣機計畫。比照下面這行的格式新增一個區塊:第一欄填「產品名稱 Proto Plan」," +
      "後面接各階段名稱,下面幾列是用途單位與台數。";
    r += 2;
  }

  r++;
  ws.getCell(r, 1).value =
    "改完存檔,回程式按「匯入 Excel」。要新增產品,比照上面的格式加一個新區塊:" +
    "第一欄填「產品名稱 Proto Plan」,後面接各階段名稱。";
  ws.getCell(r, 1).font = { italic: true, color: { argb: "FF808080" } };

  // exceljs 帶著自己那份舊的 @types/node,型別上的 Buffer 跟專案的對不起來;
  // 執行期拿到的是真的 Buffer。
  // @ts-expect-error - see comment above
  return (await wb.xlsx.writeBuffer()) as Buffer;
}

export async function parseProtoWorkbook(buffer: Buffer): Promise<ParsedProtoWorkbook> {
  const wb = new ExcelJS.Workbook();
  // @ts-expect-error - exceljs 的 Buffer 型別衝突
  await wb.xlsx.load(buffer);

  const ws = wb.getWorksheet(SHEET_NAME) ?? wb.worksheets[0];
  if (!ws) throw new Error("這個檔案裡沒有工作表");

  const warnings: string[] = [];
  const cells: ParsedProtoCell[] = [];

  let currentProduct: string | null = null;
  /** 這個區塊的欄位對到哪個階段名稱 —— 認欄位靠表頭文字,不是位置,使用者
   *  在區塊裡重排欄位順序也讀得對。 */
  let colToPhase = new Map<number, string>();
  let sawAnyBlock = false;

  for (let r = 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const label = textOf(row.getCell(1).value);

    if (label.endsWith(BLOCK_HEADER_SUFFIX)) {
      currentProduct = label.slice(0, -BLOCK_HEADER_SUFFIX.length).trim();
      colToPhase = new Map();
      for (let c = 2; c <= row.cellCount; c++) {
        const phaseName = textOf(row.getCell(c).value);
        if (phaseName) colToPhase.set(c, phaseName);
      }
      if (!currentProduct) {
        warnings.push(`第 ${r} 列的產品名稱是空的,這個區塊略過。`);
        currentProduct = null;
      } else {
        sawAnyBlock = true;
      }
      continue;
    }

    if (label === "" || label === SUBTOTAL_LABEL) continue; // 空白分隔列、小計列都跳過。

    if (!currentProduct) {
      warnings.push(`第 ${r} 列(${label})不在任何產品區塊裡,略過。`);
      continue;
    }

    for (const [col, phaseName] of colToPhase) {
      const raw = row.getCell(col).value;
      const n = raw === null || raw === undefined || raw === "" ? 0 : numberOf(raw);
      if (n === null) {
        warnings.push(`「${currentProduct} / ${label}」的 ${phaseName} 填的不是數字,這一格略過。`);
        continue;
      }
      if (!Number.isInteger(n) || n < 0 || n > 9999) {
        warnings.push(`「${currentProduct} / ${label}」的 ${phaseName} 是 ${n},必須是 0~9999 的整數,這一格略過。`);
        continue;
      }
      cells.push({
        product: currentProduct,
        unit: label,
        phaseName,
        qty: n,
        note: noteOf(row.getCell(col).note),
      });
    }
  }

  if (!sawAnyBlock) {
    throw new Error(
      `找不到任何「... ${BLOCK_HEADER_SUFFIX.trim()}」的區塊表頭。請用程式匯出的檔案來改,不要自己新建一份。`
    );
  }

  return { cells, warnings };
}
