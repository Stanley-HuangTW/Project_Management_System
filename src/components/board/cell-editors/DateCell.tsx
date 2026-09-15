"use client";

import { upsertCellValue } from "@/lib/actions/cell";
import { useCellSave } from "./useCellSave";
import { cellFieldClass } from "./cellFieldClass";

export function DateCell({
  boardId,
  itemId,
  columnId,
  value,
  bordered = false,
}: {
  boardId: string;
  itemId: string;
  columnId: string;
  value: string | null;
  /** 卡片裡要畫出輸入框,表格裡不要 —— 見 cellFieldClass。 */
  bordered?: boolean;
}) {
  const save = useCellSave();
  return (
    <input
      type="date"
      defaultValue={value ?? ""}
      onChange={(e) => {
        save(() => upsertCellValue(boardId, itemId, columnId, e.target.value || null));
      }}
      className={cellFieldClass(bordered)}
    />
  );
}
