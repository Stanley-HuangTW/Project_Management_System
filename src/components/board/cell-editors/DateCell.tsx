"use client";

import { useEffect, useRef } from "react";
import { useRecordedCellSave } from "./useCellSave";
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
  const save = useRecordedCellSave();
  const inputRef = useRef<HTMLInputElement>(null);
  // 輸入框是非受控的(受控的 date input 會吃掉使用者打到一半的年月日),所以儲存的日期被
  // 別處改掉(上一步/下一步、排程連動)時,要自己把新值寫回去。
  useEffect(() => {
    const input = inputRef.current;
    if (input && input.value !== (value ?? "")) input.value = value ?? "";
  }, [value]);
  return (
    <input
      ref={inputRef}
      type="date"
      defaultValue={value ?? ""}
      onChange={(e) => {
        save({ boardId, itemId, columnId, before: value, after: e.target.value || null });
      }}
      className={cellFieldClass(bordered)}
    />
  );
}
