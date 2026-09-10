/**
 * A project template is the *shape* of a phase — POC → EVT → PVT — without
 * the particulars of the run that produced it.
 *
 * Columns are recorded by name rather than by id, so a template captured on
 * one board can be applied to another; the dependencies are recorded as
 * positions within the template, because the ids they were captured from
 * belong to items that are not the ones being created.
 */

export type TemplateCell = { columnName: string; columnType: string; value: string | number };

export type TemplateItem = {
  name: string;
  /** Position of this item's parent in `items`, or null for a top-level row. */
  parentIndex: number | null;
  cells: TemplateCell[];
  /** Positions in `items` this row waits on. */
  predIndexes: number[];
};

export type TemplateContent = { items: TemplateItem[] };

type SourceItem = {
  id: string;
  name: string;
  parentId: string | null;
  order: number;
  cellValues: { columnId: string; value: unknown }[];
};

type SourceColumn = { id: string; name: string; type: string };

/**
 * Captures a group's items as a template.
 *
 * `excludedColumnIds` is what makes this a template rather than a copy: the
 * owners, the progress and the dates of the run being captured are exactly
 * what the next project does not want to inherit.
 */
export function buildTemplateContent(
  items: SourceItem[],
  columns: SourceColumn[],
  predsByItemId: Map<string, string[]>,
  excludedColumnIds: Set<string>
): TemplateContent {
  const ordered = orderDepthFirst(items);
  const indexById = new Map(ordered.map((item, i) => [item.id, i]));
  const columnById = new Map(columns.map((c) => [c.id, c]));

  const templateItems = ordered.map((item) => {
    const cells: TemplateCell[] = [];
    for (const cv of item.cellValues) {
      if (excludedColumnIds.has(cv.columnId)) continue;
      const column = columnById.get(cv.columnId);
      if (!column) continue;
      if (typeof cv.value !== "string" && typeof cv.value !== "number") continue;
      cells.push({ columnName: column.name, columnType: column.type, value: cv.value });
    }
    return {
      name: item.name,
      parentIndex: item.parentId != null ? indexById.get(item.parentId) ?? null : null,
      cells,
      // A dependency on something outside the captured group cannot be
      // recreated, so it is dropped rather than left pointing at a stranger.
      predIndexes: (predsByItemId.get(item.id) ?? [])
        .map((id) => indexById.get(id))
        .filter((i): i is number => i !== undefined),
    };
  });

  return { items: templateItems };
}

/** Parents before children, siblings in board order — so applying a template
 *  can create rows in one pass and always have the parent already. */
function orderDepthFirst(items: SourceItem[]): SourceItem[] {
  const childrenOf = new Map<string | null, SourceItem[]>();
  for (const item of items) {
    const list = childrenOf.get(item.parentId) ?? [];
    list.push(item);
    childrenOf.set(item.parentId, list);
  }
  for (const list of childrenOf.values()) list.sort((a, b) => a.order - b.order);

  const ordered: SourceItem[] = [];
  const seen = new Set<string>();
  function walk(parentId: string | null) {
    for (const item of childrenOf.get(parentId) ?? []) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      ordered.push(item);
      walk(item.id);
    }
  }
  walk(null);
  // An item whose parent is not in the captured set would otherwise vanish.
  for (const item of items) {
    if (!seen.has(item.id)) {
      seen.add(item.id);
      ordered.push({ ...item, parentId: null });
    }
  }
  return ordered;
}

/** Reads a stored template back. The column is Json and templates outlive
 *  the boards they came from, so anything malformed is dropped. */
export function parseTemplateContent(raw: unknown): TemplateContent {
  if (!raw || typeof raw !== "object") return { items: [] };
  const list = (raw as Record<string, unknown>).items;
  if (!Array.isArray(list)) return { items: [] };

  const items: TemplateItem[] = [];
  for (const entry of list) {
    if (!entry || typeof entry !== "object") continue;
    const { name, parentIndex, cells, predIndexes } = entry as Record<string, unknown>;
    if (typeof name !== "string") continue;
    items.push({
      name,
      parentIndex: typeof parentIndex === "number" ? parentIndex : null,
      cells: Array.isArray(cells)
        ? cells.flatMap((cell) => {
            if (!cell || typeof cell !== "object") return [];
            const { columnName, columnType, value } = cell as Record<string, unknown>;
            if (typeof columnName !== "string" || typeof columnType !== "string") return [];
            if (typeof value !== "string" && typeof value !== "number") return [];
            return [{ columnName, columnType, value }];
          })
        : [],
      predIndexes: Array.isArray(predIndexes)
        ? predIndexes.filter((i): i is number => typeof i === "number")
        : [],
    });
  }

  // A parent or a dependency pointing outside the list (a truncated or
  // hand-edited row) would nest an item under nothing at all.
  return {
    items: items.map((item) => ({
      ...item,
      parentIndex:
        item.parentIndex !== null && item.parentIndex >= 0 && item.parentIndex < items.length
          ? item.parentIndex
          : null,
      predIndexes: item.predIndexes.filter((i) => i >= 0 && i < items.length),
    })),
  };
}
