import { parseClipboardTable } from "@/lib/clipboardTable";
import { isCustomColumn, type BomColumnDef } from "@/lib/bomColumns";

/**
 * 從 Excel / Google 試算表貼上整張 BOM — 純邏輯。
 *
 * 貼上的文字是一列一列、欄用 Tab 分開(見 parseClipboardTable)。欄位的對應有兩種:
 *   - 第一列是表頭(名稱、廠商、型號、數量、單價、幣別、匯率、交期、備註,順序不拘,多的欄位如「小計」忽略):照表頭的字找;
 *     表頭多一欄「階層」(也認 BOM LEVEL、Level、層級、Lv;0 或 1 起算都行,最小的就是最上層)就用它排出上下層。
 *     看板的自訂欄位剛好也叫「BOM LEVEL」之類的名字時,階層照排,數字也存進那個自訂欄位。
 *   - 沒有表頭:照畫面上的欄位順序——名稱、廠商、型號/料號、數量、單價、幣別、匯率、交期、備註;
 *     名稱前面縮排(每兩個空白一層)就是子項目。
 *   看板設定過的欄位名稱也認得:內建欄位改了名(廠商 → 供應商)、自訂欄位(驗證狀態…),表頭寫那個名稱就對得上
 *   (自訂欄位只能靠表頭,沒有表頭時沒辦法照順序猜)。
 * 填空白的欄位用預設:數量 1、單價 0、幣別 TWD。匯率空白的外幣,由伺服器用目前的匯率補。
 * 有問題的列整列略過並說明是第幾列、什麼原因,其他列照常貼上,不會因為一列壞掉整份貼不進來。
 */

export const MAX_PASTED_BOM_ROWS = 300;

export type PastedBomRow = {
  /** 0 = 最上層,1 = 上一個 0 的子項目…。 */
  depth: number;
  name: string;
  vendor: string;
  partNumber: string;
  qty: number;
  unitPrice: number;
  currency: string;
  /** null = 沒填;台幣是 1,外幣由伺服器用目前匯率補。 */
  fxRate: number | null;
  /** "YYYY-MM-DD"。 */
  deliveryDate: string | null;
  note: string;
  /** 自訂欄位的值(欄位代號 → 貼上的文字,沒整理過,由伺服器依欄位類型讀):只有表頭裡找得到的自訂欄位才有 key。 */
  extra?: Record<string, string>;
  /** 在貼上的文字裡是第幾列(從 1 起算,含表頭),說明用。 */
  sourceRow: number;
};

type Field = "name" | "vendor" | "partNumber" | "qty" | "unitPrice" | "currency" | "fxRate" | "deliveryDate" | "note" | "level";

const ALIASES: Record<Field, string[]> = {
  name: ["名稱", "品名", "項目", "料件", "零件", "name", "item", "description"],
  vendor: ["廠商", "供應商", "製造商", "vendor", "supplier", "manufacturer"],
  partNumber: ["型號", "料號", "型號/料號", "規格", "part number", "partnumber", "p/n", "pn", "mpn", "model"],
  qty: ["數量", "qty", "quantity"],
  unitPrice: ["單價", "價格", "價錢", "unit price", "unitprice", "price"],
  currency: ["幣別", "幣種", "currency"],
  fxRate: ["匯率", "rate", "fx", "fx rate"],
  deliveryDate: ["交期", "交貨日", "交貨日期", "delivery", "lead time", "eta"],
  note: ["備註", "說明", "note", "notes", "remark", "remarks"],
  // 「BOM LEVEL」是 ERP / PLM 匯出 BOM 最常見的階層欄名稱。
  level: ["階層", "層級", "level", "depth", "bom level", "bomlevel", "bom 階層", "bom階層", "bom 層級", "bom層級", "lv", "lvl"],
};

/** 沒有表頭時,照畫面上的欄位順序。 */
const POSITIONAL: Field[] = ["name", "vendor", "partNumber", "qty", "unitPrice", "currency", "fxRate", "deliveryDate", "note"];

const MAX_LEN = { name: 200, vendor: 100, partNumber: 100, note: 500 };

/** 內建欄位在貼上時對到的欄位。 */
const BUILT_IN_PASTE_FIELD: Record<string, Field> = { vendor: "vendor", partNumber: "partNumber", delivery: "deliveryDate", note: "note" };

function fieldOfHeader(cell: string, configured: Map<string, Field>): Field | null {
  const text = cell.trim().toLowerCase();
  if (!text) return null;
  const named = configured.get(text); // 看板設定的名稱優先(內建欄位改過名)
  if (named) return named;
  for (const field of Object.keys(ALIASES) as Field[]) if (ALIASES[field].includes(text)) return field;
  return null;
}

/** 空白是 null;「1,250」「NT$1,250」「$ 12.5」「300 元」都讀得到;不是數字回 NaN。 */
export function numberOf(text: string): number | null {
  const cleaned = text
    .trim()
    .replace(/^(nt\$|us\$|\$|¥|￥|€|£)/i, "")
    .replace(/元$/, "")
    .replace(/[,\s]/g, "");
  if (cleaned === "") return null;
  return Number(cleaned);
}

/** "2026/10/8"、"2026-10-08" → "2026-10-08";不合法回 undefined,空白回 null。 */
export function dateOf(text: string): string | null | undefined {
  const t = text.trim();
  if (t === "") return null;
  const m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(t);
  if (!m) return undefined;
  const iso = `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  const d = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== iso ? undefined : iso;
}

/** 名稱前面的縮排:空白(含全形、不換行空白)每兩個算一層。 */
function indentOf(text: string): number {
  const m = /^[  　]*/.exec(text);
  return Math.floor((m ? m[0].length : 0) / 2);
}

export type ParsedBomPaste = {
  rows: PastedBomRow[];
  /** 略過的列與原因。 */
  warnings: string[];
  /** 第一列被當成表頭。 */
  hadHeader: boolean;
  /** 表頭裡對到的自訂欄位名稱(預覽時說一聲有讀到)。 */
  customColumnNames: string[];
  error?: string;
};

export function parseBomPaste(text: string, columns: BomColumnDef[] = []): ParsedBomPaste {
  // 看板設定的欄位名稱:內建欄位的新名字 → 欄位;自訂欄位的名字 → 代號。
  const configured = new Map<string, Field>();
  const customIdByName = new Map<string, { id: string; name: string }>();
  for (const c of columns) {
    const key = c.name.trim().toLowerCase();
    if (c.id in BUILT_IN_PASTE_FIELD) configured.set(key, BUILT_IN_PASTE_FIELD[c.id]);
    else if (isCustomColumn(c) && !customIdByName.has(key)) customIdByName.set(key, { id: c.id, name: c.name });
  }
  const table = parseClipboardTable(text).map((r) => r);
  if (table.length === 0 || table.every((r) => r.every((c) => c.trim() === ""))) {
    return { rows: [], warnings: [], hadHeader: false, customColumnNames: [], error: "沒有內容可以貼上" };
  }

  // 表頭:第一列至少有兩格是認得的欄位名稱。
  const firstFields = table[0].map((c) => fieldOfHeader(c, configured));
  // 表頭:第一列至少有兩格是認得的欄位名稱(自訂欄位的名字也算)。
  const customHeaderHits = table[0].filter((c) => customIdByName.has(c.trim().toLowerCase())).length;
  const hadHeader = firstFields.filter((f) => f !== null).length + customHeaderHits >= 2;
  const columnOf = new Map<Field, number>();
  /** 自訂欄位在貼上的表裡是第幾欄(欄位代號 → 欄的位置)。 */
  const customColumnOf = new Map<string, number>();
  const customColumnNames: string[] = [];
  if (hadHeader) {
    firstFields.forEach((f, i) => {
      if (f && !columnOf.has(f)) columnOf.set(f, i);
    });
    if (!columnOf.has("name")) return { rows: [], warnings: [], hadHeader, customColumnNames: [], error: "表頭裡找不到「名稱」欄" };
    table[0].forEach((headerCell, i) => {
      const custom = customIdByName.get(headerCell.trim().toLowerCase());
      if (custom && !customColumnOf.has(custom.id)) {
        customColumnOf.set(custom.id, i);
        customColumnNames.push(custom.name);
      }
    });
  } else {
    POSITIONAL.forEach((f, i) => columnOf.set(f, i));
  }

  const dataStart = hadHeader ? 1 : 0;
  const cell = (row: string[], f: Field) => {
    const i = columnOf.get(f);
    return i === undefined ? "" : (row[i] ?? "");
  };

  const rows: PastedBomRow[] = [];
  const warnings: string[] = [];
  for (let n = dataStart; n < table.length; n++) {
    const raw = table[n];
    const sourceRow = n + 1;
    if (raw.every((c) => c.trim() === "")) continue;
    const nameCell = cell(raw, "name");
    const name = nameCell.trim();
    // 試算表底下的小計、合計列:不是料。
    if (/^(合計|總計|單台成本|小計|total)/i.test(name)) continue;
    if (name === "") {
      warnings.push(`第 ${sourceRow} 列沒有名稱,略過。`);
      continue;
    }
    const label = `第 ${sourceRow} 列「${name}」`;

    const qtyN = numberOf(cell(raw, "qty"));
    if (qtyN !== null && (!Number.isFinite(qtyN) || qtyN <= 0)) {
      warnings.push(`${label}的數量必須是大於 0 的數字,略過。`);
      continue;
    }
    const priceN = numberOf(cell(raw, "unitPrice"));
    if (priceN !== null && (!Number.isFinite(priceN) || priceN < 0)) {
      warnings.push(`${label}的單價必須是 0 或正數,略過。`);
      continue;
    }
    const currency = cell(raw, "currency").trim().toUpperCase() || "TWD";
    if (!/^[A-Z]{3}$/.test(currency)) {
      warnings.push(`${label}的幣別請填三個英文字母(例如 USD),略過。`);
      continue;
    }
    const fxN = numberOf(cell(raw, "fxRate"));
    if (fxN !== null && (!Number.isFinite(fxN) || fxN <= 0)) {
      warnings.push(`${label}的匯率必須大於 0,略過。`);
      continue;
    }
    const vendor = cell(raw, "vendor").trim();
    const partNumber = cell(raw, "partNumber").trim();
    const note = cell(raw, "note").trim();
    const tooLong =
      name.length > MAX_LEN.name ? "名稱" : vendor.length > MAX_LEN.vendor ? "廠商" : partNumber.length > MAX_LEN.partNumber ? "型號" : note.length > MAX_LEN.note ? "備註" : null;
    if (tooLong) {
      warnings.push(`${label}的${tooLong}太長了,略過。`);
      continue;
    }
    let deliveryDate = dateOf(cell(raw, "deliveryDate"));
    if (deliveryDate === undefined) {
      warnings.push(`${label}的交期日期格式不對(請用 2026-10-08),這一欄留空。`);
      deliveryDate = null;
    }

    let depth = 0;
    if (columnOf.has("level")) {
      const lv = numberOf(cell(raw, "level"));
      depth = lv !== null && Number.isFinite(lv) && lv >= 0 ? Math.floor(lv) : 0;
    } else {
      depth = indentOf(nameCell);
    }
    const extra: Record<string, string> | undefined =
      customColumnOf.size > 0 ? Object.fromEntries([...customColumnOf].map(([id, i]) => [id, (raw[i] ?? "").trim()])) : undefined;
    rows.push({
      depth,
      name,
      vendor,
      partNumber,
      qty: qtyN ?? 1,
      unitPrice: priceN ?? 0,
      currency,
      fxRate: currency === "TWD" ? 1 : fxN,
      deliveryDate,
      note,
      ...(extra ? { extra } : {}),
      sourceRow,
    });
  }

  if (rows.length > MAX_PASTED_BOM_ROWS) {
    return { rows: [], warnings, hadHeader, customColumnNames, error: `一次最多貼上 ${MAX_PASTED_BOM_ROWS} 列(這次有 ${rows.length} 列),請分批貼。` };
  }

  // 階層從 1 起算的表(最上層寫 1)整體往上提;之後每一列最多比上一列深一層,不會冒出沒有上層的子項目。
  if (columnOf.has("level") && rows.length > 0) {
    const min = Math.min(...rows.map((r) => r.depth));
    if (min > 0) for (const r of rows) r.depth -= min;
  }
  let prev = -1;
  for (const r of rows) {
    r.depth = Math.min(r.depth, prev + 1);
    prev = r.depth;
  }
  return { rows, warnings, hadHeader, customColumnNames };
}
