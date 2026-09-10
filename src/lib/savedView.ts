import type { ActiveFilter, FilterValue } from "@/lib/filter";

/** What a saved view puts back on screen. The Gantt has no name search, so
 *  it ignores searchQuery; the table has no parent filter. Each view applies
 *  the parts the current view understands. */
export type ViewConfig = {
  filters: ActiveFilter[];
  groupFilterId: string;
  searchQuery: string;
};

export const EMPTY_VIEW_CONFIG: ViewConfig = { filters: [], groupFilterId: "", searchQuery: "" };

function parseFilterValue(raw: unknown): FilterValue | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  const nullableNumber = (v: unknown) => (typeof v === "number" ? v : null);
  const nullableString = (v: unknown) => (typeof v === "string" && v ? v : null);

  switch (value.kind) {
    case "text":
      return { kind: "text", query: typeof value.query === "string" ? value.query : "" };
    case "status":
      return { kind: "status", selected: strings(value.selected) };
    case "person":
      return { kind: "person", selected: strings(value.selected) };
    case "number":
      return { kind: "number", min: nullableNumber(value.min), max: nullableNumber(value.max) };
    case "date":
      return { kind: "date", from: nullableString(value.from), to: nullableString(value.to) };
    default:
      return null;
  }
}

/**
 * Reads a stored view back into something the board can apply.
 *
 * The column is Json and a view outlives the board it was saved on: a column
 * it filtered may since have been deleted, and a hand-edited row can hold
 * anything at all. Whatever does not parse is dropped — a view that shows a
 * few filters less is usable; one that throws on open is not.
 */
export function parseViewConfig(raw: unknown): ViewConfig {
  if (!raw || typeof raw !== "object") return EMPTY_VIEW_CONFIG;
  const config = raw as Record<string, unknown>;
  const filters: ActiveFilter[] = [];
  if (Array.isArray(config.filters)) {
    for (const entry of config.filters) {
      if (!entry || typeof entry !== "object") continue;
      const { columnId, value } = entry as Record<string, unknown>;
      if (typeof columnId !== "string") continue;
      const parsed = parseFilterValue(value);
      if (parsed) filters.push({ columnId, value: parsed });
    }
  }
  return {
    filters,
    groupFilterId: typeof config.groupFilterId === "string" ? config.groupFilterId : "",
    searchQuery: typeof config.searchQuery === "string" ? config.searchQuery : "",
  };
}

/** True when a view would show the board exactly as it is now — the point at
 *  which offering to save it is offering to save nothing. */
export function isEmptyViewConfig(config: ViewConfig): boolean {
  return config.filters.length === 0 && !config.groupFilterId && !config.searchQuery.trim();
}
