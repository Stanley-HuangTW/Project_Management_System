/**
 * 樣機 BOM 表的欄寬:使用者可以拖曳表頭右緣調整,記在這台瀏覽器(每個看板各一份)。
 * 沒調整過的欄照原本的最小寬度排;調整過之後整張表改成「每一欄都是明確的寬度」,
 * 表格寬度 = 各欄加起來,放不下就橫向捲動(跟 Excel 一樣)。純函式,不碰畫面。
 */

/** 欄位代號(name、level、qty、unitPrice、currency、fxRate、subtotal、自訂欄位的 c_… 代號) → 寬度(px)。 */
export type BomColWidths = Record<string, number>;

export const MIN_COL_WIDTH = 48;
export const MAX_COL_WIDTH = 900;

export function clampColWidth(px: number): number {
  return Math.max(MIN_COL_WIDTH, Math.min(MAX_COL_WIDTH, Math.round(px)));
}

/** 從 localStorage 讀回來的字串:壞掉的、不是數字的、超出範圍的欄都丟掉,不讓一筆髒資料毀掉整張表。 */
export function parseColWidths(raw: string | null | undefined): BomColWidths {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: BomColWidths = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === "number" && Number.isFinite(value)) out[key] = clampColWidth(value);
    }
    return out;
  } catch {
    return {};
  }
}

/** 這一欄(表頭或儲存格)要套的樣式;沒調整過就是 undefined,照原本的最小寬度。 */
export function colWidthStyle(widths: BomColWidths | undefined, key: string): { width: number; minWidth: number } | undefined {
  const w = widths?.[key];
  return w === undefined ? undefined : { width: w, minWidth: w };
}

export const colWidthsStorageKey = (boardId: string) => `bomColWidths:${boardId}`;

export function loadColWidths(boardId: string): BomColWidths {
  try {
    return parseColWidths(window.localStorage.getItem(colWidthsStorageKey(boardId)));
  } catch {
    return {};
  }
}

/** 空的就把這個看板的紀錄整個拿掉。存不下(私密視窗、被擋)不丟錯,這次調整照樣在畫面上有效。 */
export function saveColWidths(boardId: string, widths: BomColWidths): void {
  try {
    if (Object.keys(widths).length === 0) window.localStorage.removeItem(colWidthsStorageKey(boardId));
    else window.localStorage.setItem(colWidthsStorageKey(boardId), JSON.stringify(widths));
  } catch {
    /* 存不下就算了 */
  }
}
