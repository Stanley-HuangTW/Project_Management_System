import type { ItemData } from "@/types/board";

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

  for (const item of items) {
    const matchesSearch = !query || item.name.toLowerCase().includes(query);
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
