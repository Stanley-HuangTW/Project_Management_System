/**
 * Every id under `rootId`, the root included.
 *
 * Deleting an item takes its children with it (the database used to cascade
 * that for us); trashing one has to walk the tree itself.
 */
export function collectSubtreeIds(
  items: { id: string; parentId: string | null }[],
  rootId: string
): string[] {
  const childrenOf = new Map<string, string[]>();
  for (const item of items) {
    if (!item.parentId) continue;
    const list = childrenOf.get(item.parentId) ?? [];
    list.push(item.id);
    childrenOf.set(item.parentId, list);
  }

  const ids: string[] = [];
  const seen = new Set<string>();
  const queue = [rootId];
  while (queue.length > 0) {
    const id = queue.shift()!;
    // A parent chain that somehow loops back on itself would otherwise spin
    // here forever, taking the delete request with it.
    if (seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
    queue.push(...(childrenOf.get(id) ?? []));
  }
  return ids;
}

/** One dependent's Pred cell as it was before a deletion rewrote it. */
export type PredSnapshotEntry = {
  itemId: string;
  columnId: string;
  /** null means the cell was empty — restoring it clears the cell again. */
  value: string | null;
};

/**
 * Reads back what deleteItem stored on the item. The column is Json, so the
 * shape is only a promise: anything that does not look like a snapshot entry
 * (an older row, a hand-edited value) is dropped rather than written back
 * into someone's schedule.
 */
export function parsePredSnapshot(raw: unknown): PredSnapshotEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const { itemId, columnId, value } = entry as Record<string, unknown>;
    if (typeof itemId !== "string" || typeof columnId !== "string") return [];
    if (typeof value !== "string" && value !== null) return [];
    return [{ itemId, columnId, value }];
  });
}
