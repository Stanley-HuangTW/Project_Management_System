import type { ColumnType, StatusOption } from "@/types/column";

/**
 * 看板的 CSV 備份/還原。
 *
 * 一個看板一個檔案:第一欄是隱藏用的 ID,有值代表這一列對到既有的工作項,
 * 匯入時是更新它;沒有值就當新工作項建立——跟人力表、樣機計畫那幾份 Excel
 * 同一個道理,只是這裡的「一列」是工作項,不是名額或用途單位。
 *
 * 階層跟樣機 BOM 的縮排格式一樣:CSV 沒有「這列的上層是哪一列」這種天然
 * 的東西,而且新增一整棵子樹時使用者也不會知道還沒建出來的上層 id,所以
 * 用一個數字(0 = 最上層,子項目比上層多 1)取代 parentId,程式自己找最近
 * 的上一層對回去。
 *
 * 不碰資料庫、不碰 CSV 逐字解析(那個交給 csv-parse),這裡只管「一列的
 * 意思是什麼」跟「一格的值怎麼跟文字互轉」,所以整段邏輯測得到。
 */

export const ID_HEADER = "ID(請勿更動)";
export const DEPTH_HEADER = "階層";
export const GROUP_HEADER = "分組";
export const NAME_HEADER = "名稱";
/** 除了工作項本身四個固定欄位,後面每一欄對到看板的一個欄位。 */
export const FIXED_HEADER_COUNT = 4;
export const BOARD_ID_PREFIX = "#boardId:";
export const BOARD_NAME_PREFIX = "#boardName:";

export type BoardCsvColumn = { name: string };

export type BoardCsvRow = {
  /** 空字串 = 新工作項。 */
  id: string;
  /** 0 = 最上層。 */
  depth: number;
  groupName: string;
  name: string;
  /** 跟 columns 一一對應,已經轉成文字的顯示值。 */
  cells: string[];
};

/** RFC4180:含逗號、雙引號、換行的欄位要包在雙引號裡,雙引號本身要疊一個。 */
export function csvField(value: string): string {
  if (/[",\r\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

export function csvRow(fields: string[]): string {
  return fields.map(csvField).join(",");
}

export function buildBoardCsv(input: {
  boardId: string;
  boardName: string;
  columns: BoardCsvColumn[];
  rows: BoardCsvRow[];
}): string {
  const lines: string[] = [
    csvRow([`${BOARD_ID_PREFIX}${input.boardId}`]),
    csvRow([`${BOARD_NAME_PREFIX}${input.boardName}`]),
    csvRow([ID_HEADER, DEPTH_HEADER, GROUP_HEADER, NAME_HEADER, ...input.columns.map((c) => c.name)]),
    ...input.rows.map((row) =>
      csvRow([row.id, String(row.depth), row.groupName, row.name, ...row.cells])
    ),
  ];
  // CRLF——大部分試算表軟體對這個換行符最不會出錯。
  return lines.join("\r\n") + "\r\n";
}

export type ParsedBoardCsvRow = {
  /** 原始檔案裡的列號,只用來寫警告訊息。 */
  sourceRow: number;
  id: string;
  depth: number;
  groupName: string;
  name: string;
  cells: string[];
};

export type ParsedBoardCsv = {
  /** 檔案裡記的看板 id;找不到就是 null,由呼叫端決定要不要拒絕。 */
  boardId: string | null;
  boardName: string | null;
  /** 跟每一列 cells 陣列的位置對應。 */
  columnNames: string[];
  rows: ParsedBoardCsvRow[];
  warnings: string[];
};

/**
 * 從 csv-parse 讀出來的二維陣列(字串矩陣)解析成結構化的列。
 *
 * 不在這裡逐字元解析 CSV——那件事 csv-parse 已經做得比自己重寫可靠,這裡
 * 只管認出表頭列、後面重建階層跟工作項本身要用的四個固定欄位。
 */
export function parseBoardCsv(rows: (string | null)[][]): ParsedBoardCsv {
  let boardId: string | null = null;
  let boardName: string | null = null;
  let headerRowIndex = -1;

  for (let i = 0; i < rows.length; i++) {
    const first = (rows[i][0] ?? "").trim();
    if (first.startsWith(BOARD_ID_PREFIX)) boardId = first.slice(BOARD_ID_PREFIX.length).trim();
    else if (first.startsWith(BOARD_NAME_PREFIX)) boardName = first.slice(BOARD_NAME_PREFIX.length).trim();
    else if (first === ID_HEADER) {
      headerRowIndex = i;
      break;
    }
  }
  if (headerRowIndex === -1) {
    throw new Error(
      `找不到欄位標題列(第一欄要是「${ID_HEADER}」)。請用程式匯出的檔案來改,不要自己新建一份。`
    );
  }

  const header = rows[headerRowIndex];
  const columnNames = header.slice(FIXED_HEADER_COUNT).map((h) => (h ?? "").trim());

  const parsedRows: ParsedBoardCsvRow[] = [];
  const warnings: string[] = [];

  for (let i = headerRowIndex + 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || r.every((c) => (c ?? "").trim() === "")) continue; // 完全空白的一列,排版用,略過。

    const name = (r[3] ?? "").trim();
    if (!name) {
      warnings.push(`第 ${i + 1} 列沒有名稱,這一列略過。`);
      continue;
    }
    const depthRaw = Number((r[1] ?? "0").trim() || "0");
    parsedRows.push({
      sourceRow: i + 1,
      id: (r[0] ?? "").trim(),
      depth: Number.isFinite(depthRaw) ? Math.max(0, Math.round(depthRaw)) : 0,
      groupName: (r[2] ?? "").trim(),
      name,
      cells: columnNames.map((_, idx) => (r[FIXED_HEADER_COUNT + idx] ?? "").toString()),
    });
  }

  return { boardId, boardName, columnNames, rows: parsedRows, warnings };
}

export type DepthTreeRow = { depth: number };
export type RootedDepthRow<T> = T & { parentIndex: number | null };

/**
 * 把「階層 + 一列列往下」的縮排格式,依階層數字還原成父子關係——上層是
 * 「往上找最近一筆階層剛好少 1 的那一列」。跟樣機 BOM 的 reconstructBomTree
 * 是同一個算法,這裡另外寫一份而不是共用:兩邊的型別跟使用情境不同,硬併
 * 在一起反而要為了共用改動已經測過、正在用的 BOM 那份。
 */
export function reconstructDepthTree<T extends DepthTreeRow>(
  rows: T[]
): { rows: RootedDepthRow<T>[]; warnings: string[] } {
  const warnings: string[] = [];
  const stack: number[] = [];
  const out: RootedDepthRow<T>[] = [];

  rows.forEach((row, i) => {
    let depth = row.depth;
    if (depth > stack.length) {
      warnings.push(`第 ${i + 1} 筆的階層跳太多,自動當成上一列的下一層。`);
      depth = stack.length;
    }
    const parentIndex = depth > 0 ? stack[depth - 1] : null;
    out.push({ ...row, depth, parentIndex });
    stack[depth] = i;
    stack.length = depth + 1;
  });

  return { rows: out, warnings };
}

export type CellCodecContext = {
  /** 這一格所在欄位的類型。 */
  type: ColumnType;
  /** STATUS 欄位才用得到。 */
  statusOptions?: StatusOption[];
  /** PERSON 欄位才用得到:id → 顯示名稱。 */
  personNameById?: Map<string, string>;
};

/** 一格的值(CellValue.value 的形狀)轉成 CSV 裡看得懂的文字。 */
export function cellValueToCsvText(
  raw: string | number | null | undefined,
  ctx: CellCodecContext
): string {
  if (raw === null || raw === undefined || raw === "") return "";
  switch (ctx.type) {
    case "PERSON": {
      const id = typeof raw === "string" ? raw : String(raw);
      return ctx.personNameById?.get(id) ?? id;
    }
    case "STATUS": {
      const opt = ctx.statusOptions?.find((o) => o.id === raw);
      return opt?.label ?? String(raw);
    }
    case "DATE":
      return typeof raw === "string" ? raw : "";
    case "NUMBER":
      return typeof raw === "number" ? String(raw) : "";
    case "TEXT":
    default:
      return typeof raw === "string" ? raw : String(raw);
  }
}

export type CellParseResult =
  | { kind: "value"; value: string | number | null }
  /** STATUS 欄位,文字對不到任何既有選項——呼叫端(有資料庫)決定要不要新增。 */
  | { kind: "newStatus"; label: string }
  | { kind: "warning"; message: string };

/** CSV 裡的一格文字,轉回 CellValue.value 該存的形狀。 */
export function cellTextToValue(
  text: string,
  ctx: {
    type: ColumnType;
    statusOptions?: StatusOption[];
    /** 小寫姓名 → id,PERSON 欄位比對用。 */
    personIdByLowerName?: Map<string, string>;
  }
): CellParseResult {
  const trimmed = text.trim();
  if (trimmed === "") return { kind: "value", value: null };

  switch (ctx.type) {
    case "PERSON": {
      // CellValue 目前一格只存一個 id,多個名字只認第一個。
      const first = trimmed.split(",")[0]?.trim() ?? "";
      const id = ctx.personIdByLowerName?.get(first.toLowerCase());
      if (!id) return { kind: "warning", message: `找不到「${first}」這個人或資源` };
      return { kind: "value", value: id };
    }
    case "STATUS": {
      const opt = ctx.statusOptions?.find((o) => o.label.toLowerCase() === trimmed.toLowerCase());
      if (opt) return { kind: "value", value: opt.id };
      return { kind: "newStatus", label: trimmed };
    }
    case "DATE": {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
        return { kind: "warning", message: `日期看不懂:「${trimmed}」,格式要是 YYYY-MM-DD` };
      }
      return { kind: "value", value: trimmed };
    }
    case "NUMBER": {
      const n = Number(trimmed);
      if (!Number.isFinite(n)) return { kind: "warning", message: `不是數字:「${trimmed}」` };
      return { kind: "value", value: n };
    }
    case "TEXT":
    default:
      return { kind: "value", value: trimmed };
  }
}
