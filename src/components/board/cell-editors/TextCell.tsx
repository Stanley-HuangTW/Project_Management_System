"use client";

import { useState } from "react";
import { normalizeTextInput } from "@/lib/cellValue";
import { cellFieldClass } from "./cellFieldClass";
import { useRecordedCellSave } from "./useCellSave";

export function TextCell({
  boardId,
  itemId,
  columnId,
  value,
  bordered = false,
}: {
  boardId: string;
  itemId: string;
  columnId: string;
  value: string;
  /** 卡片裡要畫出輸入框,表格裡不要 —— 見 cellFieldClass。 */
  bordered?: boolean;
}) {
  const [text, setText] = useState(value);
  // 儲存的值被別處改掉(上一步/下一步、別人的修改)時,輸入框要跟著變。
  const [prevValue, setPrevValue] = useState(value);
  if (value !== prevValue) {
    setPrevValue(value);
    setText(value);
  }
  const save = useRecordedCellSave();

  function commit() {
    if (text !== value) {
      save({ boardId, itemId, columnId, before: normalizeTextInput(value), after: normalizeTextInput(text) });
    }
  }

  return (
    <input
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur();
      }}
      className={cellFieldClass(bordered)}
    />
  );
}
