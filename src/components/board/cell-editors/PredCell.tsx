"use client";

import { useMemo } from "react";
import { upsertCellValue } from "@/lib/actions/cell";
import { computeWbsCodes } from "@/lib/wbs";
import { useCellSave } from "./useCellSave";
import { PredPicker } from "./PredPicker";
import type { ItemData } from "@/types/board";

/** The table's Pred cell — the picker itself lives in PredPicker, shared with
 *  the assignment modal's own Pred field. */
export function PredCell({
  boardId,
  itemId,
  columnId,
  value,
  groupItems,
  wbsCodes,
}: {
  boardId: string;
  itemId: string;
  columnId: string;
  value: string | null;
  groupItems: ItemData[];
  /** Precomputed via computeWbsCodes(groupItems) by a memoized ancestor
   *  (GroupSection) — pass this on the table's per-row hot path so 2000
   *  rows don't each redo an O(n) WBS-numbering pass over the whole group.
   *  Falls back to computing it locally for lower-frequency callers (the
   *  item detail modal, opened one item at a time) that don't have one. */
  wbsCodes?: Map<string, string>;
}) {
  const codes = wbsCodes ?? computeWbsCodes(groupItems);
  const options = useMemo(
    () =>
      groupItems
        .filter((i) => i.id !== itemId)
        .map((i) => ({ id: i.id, code: codes.get(i.id) ?? "", name: i.name }))
        .filter((o) => o.code)
        .sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true })),
    [groupItems, itemId, codes]
  );

  const currentItem = groupItems.find((i) => i.id === itemId);
  const parentCode = currentItem?.parentId ? codes.get(currentItem.parentId) : undefined;
  const save = useCellSave();

  return (
    <PredPicker
      value={value}
      options={options}
      parentCode={parentCode}
      onChange={(next) => save(() => upsertCellValue(boardId, itemId, columnId, next))}
    />
  );
}
