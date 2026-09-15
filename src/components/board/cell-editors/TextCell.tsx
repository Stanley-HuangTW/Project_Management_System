"use client";

import { useState } from "react";
import { upsertCellValue } from "@/lib/actions/cell";
import { normalizeTextInput } from "@/lib/cellValue";
import { cellFieldClass } from "./cellFieldClass";

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

  function save() {
    if (text !== value) {
      upsertCellValue(boardId, itemId, columnId, normalizeTextInput(text));
    }
  }

  return (
    <input
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
