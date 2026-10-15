import { getStatusOptions } from "@/types/column";
import { formatPredEntries, parsePredEntries, splitPredEntry, type WbsIndex } from "@/lib/predecessorLink";

/**
 * 跨看板複製 / 移動的純邏輯:兩個看板的欄位 id 各自獨立,所以欄位值要先對應到目標看板的欄位;
 * 前置依賴(Pred)是「項目 id」,跨看板只保留這次一起處理的項目之間的。
 */

export type ColumnLite = { id: string; name: string; type: string; options: unknown };

export type ColumnMapping = {
  targetId: string;
  /** 狀態類欄位:來源選項 id → 目標選項 id;其他類型是 null(值原樣帶過去)。 */
  optionMap: Map<string, string> | null;
};

/** 狀態選項依名稱對應(名稱才是使用者看得懂的);名稱對不上、但目標有同一個 id 的也算。 */
function buildOptionMap(sourceOptions: unknown, targetOptions: unknown): Map<string, string> {
  const targets = getStatusOptions(targetOptions);
  const map = new Map<string, string>();
  for (const option of getStatusOptions(sourceOptions)) {
    const hit = targets.find((t) => t.label.trim() === option.label.trim()) ?? targets.find((t) => t.id === option.id);
    if (hit) map.set(option.id, hit.id);
  }
  return map;
}

/**
 * 來源欄位 → 目標欄位:名稱相同、類型相同才對應(同名同類型有好幾個時依目標的順序各取一個)。
 * skipSourceIds 是要另外處理的欄位(例如 Pred),不放進一般對應。
 */
export function planColumnMapping(
  source: ColumnLite[],
  target: ColumnLite[],
  skipSourceIds: ReadonlySet<string> = new Set()
): Map<string, ColumnMapping> {
  const used = new Set<string>();
  const mapping = new Map<string, ColumnMapping>();
  for (const column of source) {
    if (skipSourceIds.has(column.id)) continue;
    const match = target.find((t) => t.name === column.name && t.type === column.type && !used.has(t.id));
    if (!match) continue;
    used.add(match.id);
    mapping.set(column.id, {
      targetId: match.id,
      optionMap: column.type === "STATUS" ? buildOptionMap(column.options, match.options) : null,
    });
  }
  return mapping;
}

/** 一格的值換成目標看板的值;狀態選項在目標看板找不到對應就回 ok:false(略過這一格)。 */
export function mapCellValue(mapping: ColumnMapping, value: unknown): { ok: true; value: unknown } | { ok: false } {
  if (!mapping.optionMap || typeof value !== "string") return { ok: true, value };
  const next = mapping.optionMap.get(value);
  return next ? { ok: true, value: next } : { ok: false };
}

/**
 * 複本的 Pred 值(跨看板):只留下指到「這次一起複製的項目」的,改指到它們的複本;其餘清掉。
 * dropped 是被清掉的條數。逐筆解析再寫回,每條依賴自己的 :FS/:SS 與 +N 天延遲都保留。
 */
export function remapPredAcrossBoards(
  index: WbsIndex,
  sourceGroupId: string,
  value: unknown,
  idOf: (sourceId: string) => string | undefined
): { value: string | null; dropped: number } {
  const entries = parsePredEntries(index, sourceGroupId, value);
  const kept = entries.flatMap((entry) => {
    const id = idOf(entry.itemId);
    return id ? [{ ...entry, itemId: id }] : [];
  });
  return { value: formatPredEntries(kept), dropped: entries.length - kept.length };
}

/**
 * 從別的項目的 Pred 值裡拿掉某些項目(它們被搬到別的看板了)。沒有受影響就 changed:false;
 * 拿光了 value 是 null(清空那一格)。沒被拿掉的條目維持原樣(連 :FS、+N 天都不動)。
 */
export function stripPredReferences(
  value: unknown,
  removed: ReadonlySet<string>
): { changed: boolean; value: string | null } {
  if (typeof value !== "string" || !value.trim()) return { changed: false, value: null };
  const parts = value.split(",").map((p) => p.trim()).filter(Boolean);
  const kept = parts.filter((part) => !removed.has(splitPredEntry(part).ref));
  if (kept.length === parts.length) return { changed: false, value };
  return { changed: true, value: kept.length > 0 ? kept.join(",") : null };
}
