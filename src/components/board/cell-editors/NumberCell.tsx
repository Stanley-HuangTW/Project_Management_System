"use client";

import { useState } from "react";
import { parseNumberInput } from "@/lib/cellValue";
import { useRecordedCellSave } from "./useCellSave";
import { cellFieldClass } from "./cellFieldClass";

export function NumberCell({
  boardId,
  itemId,
  columnId,
  value,
  bordered = false,
  percent = false,
}: {
  boardId: string;
  itemId: string;
  columnId: string;
  value: number | null;
  /** 卡片裡要畫出輸入框,表格裡不要 —— 見 cellFieldClass。 */
  bordered?: boolean;
  percent?: boolean;
}) {
  const displayValue = percent && value !== null ? Math.round(value * 100) : value;
  const [text, setText] = useState(displayValue === null ? "" : String(displayValue));
  // 儲存的數字被別處改掉(上一步/下一步、排程連動)時,輸入框要跟著變。
  const [prevValue, setPrevValue] = useState(value);
  if (value !== prevValue) {
    setPrevValue(value);
    setText(displayValue === null ? "" : String(displayValue));
  }
  const runSave = useRecordedCellSave();

  function save() {
    const entered = parseNumberInput(text);
    const normalized = percent && entered !== null ? entered / 100 : entered;
    if (normalized !== value) {
      runSave({ boardId, itemId, columnId, before: value, after: normalized });
    }
  }

  return (
    <input
      type="number"
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={save}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur();
      }}
      className={cellFieldClass(bordered)}
    />
  );
}
