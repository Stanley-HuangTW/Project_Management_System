"use client";

import { useMemo } from "react";
import { computeWbsCodes } from "@/lib/wbs";
import { useRecordedCellSave } from "./useCellSave";
import { PredPicker } from "./PredPicker";
import type { ItemData, PredOption } from "@/types/board";

/** The table's Pred cell — the picker itself lives in PredPicker, shared with
 *  the assignment modal's own Pred field. */
export function PredCell({
  boardId,
  itemId,
  columnId,
  value,
  groupItems,
  wbsCodes,
  crossGroupPredOptions,
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
  /** Items in the board's other groups, already labelled with their group
   *  name — a Pred may cross a group, and a bare "1.2" from another group
   *  would be unreadable. */
  crossGroupPredOptions?: PredOption[];
}) {
  const codes = wbsCodes ?? computeWbsCodes(groupItems);
  const options = useMemo<PredOption[]>(
    () =>
      groupItems
        .filter((i) => i.id !== itemId)
        .map((i): PredOption => ({
          id: i.id,
          code: codes.get(i.id) ?? "",
          name: i.name,
          wbsCode: codes.get(i.id) ?? "",
          parentId: i.parentId,
        }))
        .filter((o) => o.code)
        .sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }))
        // Own group first, then the rest — the usual case stays at the top.
        .concat(crossGroupPredOptions ?? []),
    [groupItems, itemId, codes, crossGroupPredOptions]
  );

  const currentItem = groupItems.find((i) => i.id === itemId);
  const parentCode = currentItem?.parentId ? codes.get(currentItem.parentId) : undefined;
  const save = useRecordedCellSave();

  return (
    <PredPicker
      boardId={boardId}
      value={value}
      options={options}
      parentCode={parentCode}
      parentItemId={currentItem?.parentId ?? null}
      onChange={(next) => save({ boardId, itemId, columnId, before: value, after: next })}
    />
  );
}
