/**
 * BOM 的欄位設定:哪些欄位、什麼類型、要不要填、預設值。純函式,不碰資料庫與畫面。
 *
 * BOM 一列固定有的是「算錢」的那一塊——名稱、數量、單價、幣別、匯率、小計,動了成本就算不出來,
 * 所以不開放設定。其餘都可以設定:
 * - 內建欄位(廠商、型號/料號、交期、備註):原本就存在 BomLine 的欄位裡,可以改名、隱藏、換順序、設預設值與必填;
 *   類型固定、不能刪除(Excel 匯入匯出、備份、成本頁都靠它們)。
 * - 自訂欄位:像工作項的欄位一樣自己加,有類型(文字、數字、日期、下拉選單、人員、勾選、連結、檔案附件),
 *   值存在 BomLine.extra(以欄位代號為 key);檔案附件的檔案不在 extra 裡,存在 BomAttachment(欄位代號對得上)。
 *
 * 設定是一份有順序的清單,「金額欄位」(數量、單價、幣別、小計)是清單裡一個不能改名也不能隱藏的區塊,
 * 可以跟其他欄位一起換位置。系統設定有一份預設,看板沒有自己的設定就沿用它;看板改過就是自己的。
 */

export type BomColumnType = "TEXT" | "NUMBER" | "DATE" | "SELECT" | "PERSON" | "CHECKBOX" | "LINK" | "FILE";

export const BOM_COLUMN_TYPES: BomColumnType[] = ["TEXT", "NUMBER", "DATE", "SELECT", "PERSON", "CHECKBOX", "LINK", "FILE"];

export const BOM_COLUMN_TYPE_LABELS: Record<BomColumnType, string> = {
  TEXT: "文字",
  NUMBER: "數字",
  DATE: "日期",
  SELECT: "下拉選單",
  PERSON: "人員",
  CHECKBOX: "勾選",
  LINK: "連結",
  FILE: "檔案附件",
};

export type BomCellValue = string | number | boolean | null;

export type BomColumnDef = {
  /** 內建欄位是 vendor / partNumber / delivery / note;金額區塊是 money;自訂欄位是 c_ 開頭的唯一代號。 */
  id: string;
  name: string;
  type: BomColumnType;
  /** 下拉選單的選項;其他類型是空陣列。 */
  options: string[];
  /** 必填:沒填的列會標出來、統計缺幾筆,但不擋存檔(BOM 常常整張從 Excel 貼上)。 */
  required: boolean;
  /** 新增一列時自動帶的值。null = 沒有預設。 */
  defaultValue: BomCellValue;
  /** false = 這張表不顯示這個欄位(值還在)。 */
  visible: boolean;
};

export const MONEY_ID = "money";
export const BUILT_IN_IDS = ["vendor", "partNumber", "delivery", "note"] as const;
export type BuiltInId = (typeof BUILT_IN_IDS)[number];

/** 內建欄位對到 BomLine 上的哪個欄位。 */
export const BUILT_IN_FIELD: Record<BuiltInId, "vendor" | "partNumber" | "deliveryDate" | "note"> = {
  vendor: "vendor",
  partNumber: "partNumber",
  delivery: "deliveryDate",
  note: "note",
};

const BUILT_IN_TYPE: Record<BuiltInId, BomColumnType> = { vendor: "TEXT", partNumber: "TEXT", delivery: "DATE", note: "TEXT" };

/** 算錢的那一塊,在設定清單裡佔一格:不能改名、隱藏、設必填。 */
export const MONEY_BLOCK_NAME = "數量、單價、幣別、小計";

const def = (id: string, name: string, type: BomColumnType): BomColumnDef => ({
  id,
  name,
  type,
  options: [],
  required: false,
  defaultValue: null,
  visible: true,
});

/** 沒有任何人設定過時的欄位:跟這個功能出現之前的 BOM 一樣(交期現在排在小計後面)。 */
export const BUILT_IN_BOM_COLUMNS: BomColumnDef[] = [
  def("vendor", "廠商", "TEXT"),
  def("partNumber", "型號/料號", "TEXT"),
  def(MONEY_ID, MONEY_BLOCK_NAME, "TEXT"),
  def("delivery", "交期", "DATE"),
  def("note", "備註", "TEXT"),
];

/** 畫面上固定的欄位名稱,自訂欄位不能跟它們重名(匯入 Excel 時是靠欄位名稱對的)。 */
export const RESERVED_COLUMN_NAMES = ["名稱", "數量", "單價", "幣別", "匯率", "小計", "小計(台幣)", "階層"];

export const MAX_BOM_COLUMNS = 30;
export const MAX_COLUMN_NAME = 30;
export const MAX_SELECT_OPTIONS = 30;
export const MAX_OPTION_LENGTH = 30;
const MAX_TEXT = 500;

export const isMoneyBlock = (c: Pick<BomColumnDef, "id">): boolean => c.id === MONEY_ID;
export const isBuiltInColumn = (c: Pick<BomColumnDef, "id">): boolean => (BUILT_IN_IDS as readonly string[]).includes(c.id);
export const isCustomColumn = (c: Pick<BomColumnDef, "id">): boolean => !isMoneyBlock(c) && !isBuiltInColumn(c);
/** 值存在 BomLine.extra 裡的欄位:自訂欄位,但「檔案附件」的檔案存在 BomAttachment,不在 extra。 */
export const isStoredCustomColumn = (c: Pick<BomColumnDef, "id" | "type">): boolean => isCustomColumn(c) && c.type !== "FILE";

const CUSTOM_ID_RE = /^c_[a-z0-9]{4,16}$/;

/** 新自訂欄位的代號(畫面上按「新增欄位」時產生)。 */
export function newColumnId(): string {
  return `c_${Math.random().toString(36).slice(2, 10).padEnd(8, "0")}`;
}

/** 真的存在的日期:2026-02-30 這種會被 Date 悄悄換成 3/2,所以要轉回字串比對。 */
const isValidDate = (raw: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return false;
  const date = new Date(`${raw}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === raw;
};

/**
 * 一格的值,依欄位類型整理成要存的樣子。空的一律是 null(勾選是 false)。
 * 格式不對回錯誤說明——寫進資料庫的東西要先乾淨;下拉選單不比對選項(選項之後可能被改掉,舊的值要能留著)。
 */
export function normalizeCellValue(column: Pick<BomColumnDef, "name" | "type">, raw: unknown): { value: BomCellValue } | { error: string } {
  const name = column.name;
  const blank = raw === null || raw === undefined || raw === "";
  switch (column.type) {
    case "FILE":
      return { value: null }; // 檔案不經過這裡(另外上傳),格子上沒有「值」
    case "CHECKBOX":
      return { value: raw === true || raw === "true" || raw === 1 };
    case "TEXT": {
      if (blank) return { value: null };
      const text = String(raw).trim();
      if (text.length > MAX_TEXT) return { error: `「${name}」太長了(上限 ${MAX_TEXT} 字)` };
      return { value: text === "" ? null : text };
    }
    case "NUMBER": {
      if (blank || (typeof raw === "string" && raw.trim() === "")) return { value: null };
      const n = typeof raw === "number" ? raw : Number(String(raw).trim());
      if (!Number.isFinite(n)) return { error: `「${name}」要填數字` };
      return { value: n };
    }
    case "DATE": {
      if (blank) return { value: null };
      const text = String(raw).trim();
      return isValidDate(text) ? { value: text } : { error: `「${name}」的日期格式錯誤(要像 2026-11-30)` };
    }
    case "SELECT": {
      if (blank) return { value: null };
      const text = String(raw).trim();
      if (text.length > 100) return { error: `「${name}」的選項太長了` };
      return { value: text === "" ? null : text };
    }
    case "PERSON": {
      if (blank) return { value: null };
      const text = String(raw).trim();
      return /^[\w-]{1,60}$/.test(text) ? { value: text } : { error: `「${name}」的人員不正確` };
    }
    case "LINK": {
      if (blank) return { value: null };
      const text = String(raw).trim();
      if (text.length > MAX_TEXT) return { error: `「${name}」太長了(上限 ${MAX_TEXT} 字)` };
      try {
        const url = new URL(text);
        if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("protocol");
      } catch {
        return { error: `「${name}」要填網址(http:// 或 https:// 開頭)` };
      }
      return { value: text };
    }
  }
}

/** 沒填:空值、空字串;勾選欄位沒勾也算沒填。 */
export function isEmptyCellValue(column: Pick<BomColumnDef, "type">, value: unknown): boolean {
  if (column.type === "CHECKBOX") return value !== true;
  return value === null || value === undefined || (typeof value === "string" && value.trim() === "");
}

/**
 * 檢查整份欄位設定(使用者存檔時、讀出資料庫裡的設定時都用)。回傳整理過的設定,或第一個錯誤說明。
 * 內建欄位與金額區塊一定要各有一個、類型固定;自訂欄位要有合格的代號、名稱不重複也不跟畫面上固定的欄位重名。
 */
export function validateBomColumns(raw: unknown): { error: string } | { value: BomColumnDef[] } {
  if (!Array.isArray(raw)) return { error: "欄位設定的格式不對" };
  if (raw.length > MAX_BOM_COLUMNS) return { error: `欄位太多了(最多 ${MAX_BOM_COLUMNS} 個)` };

  const seenIds = new Set<string>();
  const seenNames = new Set<string>();
  const out: BomColumnDef[] = [];

  for (const item of raw) {
    if (!item || typeof item !== "object") return { error: "欄位設定的格式不對" };
    const r = item as Record<string, unknown>;
    const id = typeof r.id === "string" ? r.id : "";
    if (seenIds.has(id)) return { error: "欄位的代號重複了" };
    seenIds.add(id);

    if (id === MONEY_ID) {
      out.push({ ...def(MONEY_ID, MONEY_BLOCK_NAME, "TEXT") });
      continue;
    }

    const builtIn = (BUILT_IN_IDS as readonly string[]).includes(id) ? (id as BuiltInId) : null;
    if (!builtIn && !CUSTOM_ID_RE.test(id)) return { error: "欄位的代號不正確" };

    const name = (typeof r.name === "string" ? r.name : "").trim();
    if (!name) return { error: "欄位名稱不可為空" };
    if (name.length > MAX_COLUMN_NAME) return { error: `欄位名稱太長了(上限 ${MAX_COLUMN_NAME} 字):${name.slice(0, 10)}…` };
    if (RESERVED_COLUMN_NAMES.includes(name)) return { error: `「${name}」是表格上固定的欄位名稱,請換一個` };
    const nameKey = name.toLowerCase();
    if (seenNames.has(nameKey)) return { error: `欄位名稱「${name}」重複了` };
    seenNames.add(nameKey);

    if (!builtIn && !(BOM_COLUMN_TYPES as string[]).includes(r.type as string)) return { error: `「${name}」的欄位類型不正確` };
    const type: BomColumnType = builtIn ? BUILT_IN_TYPE[builtIn] : (r.type as BomColumnType);

    let options: string[] = [];
    if (type === "SELECT") {
      const list = Array.isArray(r.options) ? r.options : [];
      options = list.map((o) => (typeof o === "string" ? o.trim() : "")).filter(Boolean);
      if (options.length === 0) return { error: `「${name}」是下拉選單,至少要有一個選項` };
      if (options.length > MAX_SELECT_OPTIONS) return { error: `「${name}」的選項太多了(最多 ${MAX_SELECT_OPTIONS} 個)` };
      if (options.some((o) => o.length > MAX_OPTION_LENGTH)) return { error: `「${name}」的選項太長了(每個最多 ${MAX_OPTION_LENGTH} 字)` };
      if (new Set(options).size !== options.length) return { error: `「${name}」的選項有重複` };
    }

    let defaultValue: BomCellValue = null;
    if (type !== "PERSON" && type !== "FILE" && r.defaultValue !== null && r.defaultValue !== undefined && r.defaultValue !== "") {
      const normalized = normalizeCellValue({ name, type }, r.defaultValue);
      if ("error" in normalized) return { error: `預設值:${normalized.error}` };
      defaultValue = normalized.value;
      if (type === "SELECT" && defaultValue !== null && !options.includes(String(defaultValue))) return { error: `「${name}」的預設值不在選項裡` };
      if (type === "CHECKBOX" && defaultValue === false) defaultValue = null;
    }

    out.push({
      id,
      name,
      type,
      options,
      required: r.required === true,
      defaultValue,
      visible: r.visible !== false,
    });
  }

  for (const id of [...BUILT_IN_IDS, MONEY_ID]) {
    if (!seenIds.has(id)) return { error: id === MONEY_ID ? "金額欄位(數量、單價、幣別、小計)不能刪除" : "內建欄位(廠商、型號/料號、交期、備註)不能刪除,不想看到可以隱藏" };
  }
  return { value: out };
}

/** 資料庫裡的設定讀回來:格式不對就當沒設定(null),不要讓一份壞掉的設定把整張 BOM 表弄壞。 */
export function parseBomColumns(raw: unknown): BomColumnDef[] | null {
  if (raw === null || raw === undefined) return null;
  const checked = validateBomColumns(raw);
  return "value" in checked ? checked.value : null;
}

export type BomColumnsSource = "board" | "system" | "built-in";

/** 這個看板實際用的欄位:看板自己設定過的 → 系統預設 → 內建。 */
export function resolveBomColumns(boardRaw: unknown, systemRaw: unknown): { columns: BomColumnDef[]; source: BomColumnsSource } {
  const own = parseBomColumns(boardRaw);
  if (own) return { columns: own, source: "board" };
  const system = parseBomColumns(systemRaw);
  if (system) return { columns: system, source: "system" };
  return { columns: BUILT_IN_BOM_COLUMNS.map((c) => ({ ...c })), source: "built-in" };
}

/** 新增一列時各欄位自動帶的值(只含有預設值的欄位,不含金額區塊),key 是欄位代號。 */
export function initialColumnValues(columns: BomColumnDef[]): Record<string, BomCellValue> {
  const out: Record<string, BomCellValue> = {};
  for (const c of columns) {
    if (isMoneyBlock(c) || c.defaultValue === null) continue;
    out[c.id] = c.defaultValue;
  }
  return out;
}

/** 顯示出來的欄位裡,必填卻沒填的那幾個。hidden 的欄位不算(看不到的東西不該被提醒)。 */
export function missingRequired(columns: BomColumnDef[], valueOf: (column: BomColumnDef) => unknown): BomColumnDef[] {
  return columns.filter((c) => !isMoneyBlock(c) && c.visible && c.required && isEmptyCellValue(c, valueOf(c)));
}

/** 一整張表有幾列缺必填(整列算一筆,不管缺幾個欄位)。 */
export function countRowsMissingRequired(columns: BomColumnDef[], rows: { valueOf: (column: BomColumnDef) => unknown }[]): number {
  return rows.filter((row) => missingRequired(columns, row.valueOf).length > 0).length;
}

export type ImportUser = { id: string; name: string };

const TRUTHY = /^(是|有|v|y|yes|true|1|✓|✔|x)$/i;

/**
 * 從 Excel 貼上 / 匯入的一格文字,依欄位類型讀成要存的值。比畫面上輸入寬鬆:
 * 日期認 2026/10/8,數字認 1,250,勾選認「是、Y、1、✓」,人員拿姓名(或帳號代號)找人。
 * 空白是沒填(勾選是沒勾)。格式讀不懂回錯誤說明,呼叫端把那一格留空、其他格照存。
 */
export function importCellValue(
  column: Pick<BomColumnDef, "name" | "type" | "options">,
  text: string,
  users: ImportUser[]
): { value: BomCellValue } | { error: string } {
  const raw = text.trim();
  switch (column.type) {
    case "FILE":
      return { value: null }; // 檔案要在系統上傳,Excel 帶不進來
    case "CHECKBOX":
      return { value: TRUTHY.test(raw) };
    case "NUMBER":
      return normalizeCellValue(column, raw.replace(/^(nt\$|us\$|\$|¥|￥|€|£)/i, "").replace(/[,\s]/g, ""));
    case "DATE": {
      const m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(raw);
      return normalizeCellValue(column, m ? `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}` : raw);
    }
    case "SELECT": {
      if (raw === "") return { value: null };
      // 選項大小寫不同也算同一個;不在選項裡的原樣收(選項可能之後才補)。
      const match = column.options.find((o) => o.toLowerCase() === raw.toLowerCase());
      return normalizeCellValue(column, match ?? raw);
    }
    case "PERSON": {
      if (raw === "") return { value: null };
      const byId = users.find((u) => u.id === raw);
      if (byId) return { value: byId.id };
      const byName = users.filter((u) => u.name.trim().toLowerCase() === raw.toLowerCase());
      if (byName.length === 1) return { value: byName[0].id };
      return { error: byName.length > 1 ? `「${column.name}」的「${raw}」有好幾個同名的人` : `「${column.name}」找不到「${raw}」這個人` };
    }
    default:
      return normalizeCellValue(column, raw);
  }
}
