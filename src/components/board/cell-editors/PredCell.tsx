"use client";

import { useMemo } from "react";
import { compareNumericText, computeWbsCodes } from "@/lib/wbs";
import { useRecordedCellSave } from "./useCellSave";
import { useEditHistory } from "../EditHistoryProvider";
import { defaultNewPredRelationship } from "@/lib/predEdgeSummary";
import { getStatusOptions } from "@/types/column";
import { PredPicker } from "./PredPicker";
import type { ItemData, PredOption } from "@/types/board";

/**
 * 同一個分組的每一列都要這份選項(只差「自己」那一項不能選):整組排序一次、各列共用,不要每一列各排一次——
 * 五千項的分組,每列各排一次是 O(n²·log n)。用 codes(分組共用、項目一變就重算的那個 Map)當鑰匙,
 * 同時核對 groupItems 還是同一份;對不上(例如項目卡片自己算的)就重算。
 */
const groupOptionsCache = new WeakMap<Map<string, string>, { items: ItemData[]; options: PredOption[] }>();
function sortedGroupOptions(groupItems: ItemData[], codes: Map<string, string>): PredOption[] {
  const hit = groupOptionsCache.get(codes);
  if (hit && hit.items === groupItems) return hit.options;
  const options = groupItems
    .map((i): PredOption => ({
      id: i.id,
      code: codes.get(i.id) ?? "",
      name: i.name,
      wbsCode: codes.get(i.id) ?? "",
      parentId: i.parentId,
    }))
    .filter((o) => o.code)
    .sort((a, b) => compareNumericText(a.code, b.code));
  groupOptionsCache.set(codes, { items: groupItems, options });
  return options;
}

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
      sortedGroupOptions(groupItems, codes)
        .filter((o) => o.id !== itemId)
        // Own group first, then the rest — the usual case stays at the top.
        .concat(crossGroupPredOptions ?? []),
    [groupItems, itemId, codes, crossGroupPredOptions]
  );

  const currentItem = groupItems.find((i) => i.id === itemId);
  // 這個項目自己:不能當自己的前置(不在 options 裡),但清單要把它畫在原本的位置,標出「我在這裡」。
  const current = useMemo<PredOption | undefined>(() => {
    const code = codes.get(itemId);
    return currentItem && code
      ? { id: currentItem.id, code, name: currentItem.name, wbsCode: code, parentId: currentItem.parentId }
      : undefined;
  }, [currentItem, codes, itemId]);
  const parentCode = currentItem?.parentId ? codes.get(currentItem.parentId) : undefined;
  const save = useRecordedCellSave();
  const history = useEditHistory();
  // 選的當下才讀這個項目的 Link 欄(看板最新的資料);不在看板裡(例如儀表板打開的卡片)就當空白 → FS。
  const getDefaultRelationship = () => {
    const board = history?.getBoard();
    const linkColumn = board?.columns.find((c) => c.id === board.linkColumnId);
    const linkValue = board?.items.find((i) => i.id === itemId)?.cellValues.find((cv) => cv.columnId === linkColumn?.id)?.value;
    return defaultNewPredRelationship(getStatusOptions(linkColumn?.options).find((o) => o.id === linkValue)?.label);
  };

  return (
    <PredPicker
      boardId={boardId}
      value={value}
      options={options}
      current={current}
      getDefaultRelationship={getDefaultRelationship}
      parentCode={parentCode}
      parentItemId={currentItem?.parentId ?? null}
      onChange={(next) => save({ boardId, itemId, columnId, before: value, after: next })}
    />
  );
}
