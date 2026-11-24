import type { ItemData } from "@/types/board";
import { computeWbsCodes } from "@/lib/wbs";

export type FilterValue =
  | { kind: "text"; query: string }
  | { kind: "status"; selected: string[] }
  | { kind: "person"; selected: string[] }
  | { kind: "number"; min: number | null; max: number | null }
  | { kind: "date"; from: string | null; to: string | null };

export type ActiveFilter = { columnId: string; value: FilterValue };

// Not real Column rows — synthetic filter dimensions over Item's own
// createdById/createdAt fields, so "who/when created" is filterable without
// duplicating that data into a cell value on every item.
export const CREATED_BY_FILTER_COLUMN_ID = "__createdBy__";
export const CREATED_AT_FILTER_COLUMN_ID = "__createdAt__";

/**
 * A date filter bound to "today" rather than to a fixed day.
 *
 * Without it a saved view is only right on the day it was saved: "完成日在
 * 今天之前" — the overdue list — would freeze into "完成日在 2026-09-10 之前"
 * and mean something different every morning.
 */
export const TODAY_FILTER_VALUE = "__today__";

function resolveDateBound(bound: string | null): string | null {
  if (!bound) return null;
  return bound === TODAY_FILTER_VALUE ? new Date().toISOString().slice(0, 10) : bound;
}

function itemMatchesFilter(item: ItemData, columnId: string, value: FilterValue): boolean {
  if (columnId === CREATED_BY_FILTER_COLUMN_ID) {
    if (value.kind !== "person" || value.selected.length === 0) return true;
    return !!item.createdById && value.selected.includes(item.createdById);
  }
  if (columnId === CREATED_AT_FILTER_COLUMN_ID) {
    if (value.kind !== "date" || (!value.from && !value.to)) return true;
    const iso = item.createdAt.toISOString().slice(0, 10);
    const createdFrom = resolveDateBound(value.from);
    const createdTo = resolveDateBound(value.to);
    if (createdFrom && iso < createdFrom) return false;
    if (createdTo && iso > createdTo) return false;
    return true;
  }
  const cv = item.cellValues.find((c) => c.columnId === columnId)?.value;
  switch (value.kind) {
    case "text":
      if (!value.query.trim()) return true;
      return typeof cv === "string" && cv.toLowerCase().includes(value.query.toLowerCase());
    case "status":
      if (value.selected.length === 0) return true;
      return typeof cv === "string" && value.selected.includes(cv);
    case "person":
      if (value.selected.length === 0) return true;
      return typeof cv === "string" && value.selected.includes(cv);
    case "number":
      if (value.min === null && value.max === null) return true;
      if (typeof cv !== "number") return false;
      if (value.min !== null && cv < value.min) return false;
      if (value.max !== null && cv > value.max) return false;
      return true;
    case "date": {
      if (!value.from && !value.to) return true;
      if (typeof cv !== "string") return false;
      const from = resolveDateBound(value.from);
      const to = resolveDateBound(value.to);
      if (from && cv < from) return false;
      if (to && cv > to) return false;
      return true;
    }
  }
}

/**
 * 搜尋框的比對:項目名稱含有關鍵字,或關鍵字是項目編號(WBS,例如 1.9.3)——
 * 編號照層級比,所以「1.9」找得到 1.9 與它底下的 1.9.1、1.9.3,但不會把 1.90 也撈進來。
 */
export function itemMatchesSearch(name: string, wbsCode: string | undefined, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (name.toLowerCase().includes(q)) return true;
  if (!wbsCode || !/^[\d.]+$/.test(q)) return false;
  const code = q.replace(/\.+$/, "");
  return code !== "" && (wbsCode === code || wbsCode.startsWith(code + "."));
}

/** 每個分組各自編號(跟表格、甘特圖畫面上的編號一樣:WBS 只在自己的分組裡有意義)。 */
export function wbsCodesByGroup(items: ItemData[]): Map<string, string> {
  const byGroup = new Map<string, ItemData[]>();
  for (const item of items) {
    const list = byGroup.get(item.groupId);
    if (list) list.push(item);
    else byGroup.set(item.groupId, [item]);
  }
  const codes = new Map<string, string>();
  for (const list of byGroup.values()) for (const [id, code] of computeWbsCodes(list)) codes.set(id, code);
  return codes;
}

/**
 * Returns the set of item ids that should stay visible under the active
 * filters and/or a name search, including ancestors of any matching item so
 * the hierarchy stays intact. Returns null when there's nothing active (show
 * everything).
 */
export function computeVisibleItemIds(
  items: ItemData[],
  filters: ActiveFilter[],
  searchQuery?: string
): Set<string> | null {
  const query = searchQuery?.trim().toLowerCase();
  if (filters.length === 0 && !query) return null;

  const itemById = new Map(items.map((i) => [i.id, i]));
  const visible = new Set<string>();
  // 關鍵字是數字與點(像 1.9.3)才需要算編號,一般的名稱搜尋不多做這一步。
  const codes = query && /^[\d.]+$/.test(query) ? wbsCodesByGroup(items) : null;

  for (const item of items) {
    const matchesSearch = !query || itemMatchesSearch(item.name, codes?.get(item.id), query);
    if (matchesSearch && filters.every((f) => itemMatchesFilter(item, f.columnId, f.value))) {
      visible.add(item.id);
      let cur = item;
      while (cur.parentId) {
        if (visible.has(cur.parentId)) break;
        visible.add(cur.parentId);
        const parent = itemById.get(cur.parentId);
        if (!parent) break;
        cur = parent;
      }
    }
  }

  return visible;
}
