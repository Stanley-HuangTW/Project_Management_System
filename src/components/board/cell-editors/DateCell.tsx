"use client";

import { useEffect, useRef, useState } from "react";
import { useRecordedCellSave } from "./useCellSave";
import { cellFieldClass } from "./cellFieldClass";
import { withWeekday } from "@/lib/weekdayLabel";

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

  // 卡片裡日期旁邊寫星期幾(輸入框本身是瀏覽器的日期選擇器,沒辦法塞星期)。輸入框是非受控的,所以另外記一份
  // 畫面上的日期,跟著打字更新;儲存的日期被別處改掉時(跟上面同一個情況)換成新的。
  const [shown, setShown] = useState<string | null>(value);
  const [prevValue, setPrevValue] = useState(value);
  if (value !== prevValue) {
    setPrevValue(value);
    setShown(value);
  }
  const weekday = shown ? withWeekday(shown).slice(shown.length) : "";

  const input = (
    <input
      ref={inputRef}
      type="date"
      defaultValue={value ?? ""}
      onChange={(e) => {
        setShown(e.target.value || null);
        save({ boardId, itemId, columnId, before: value, after: e.target.value || null });
      }}
      className={cellFieldClass(bordered)}
    />
  );
  if (!bordered) return input;
  return (
    <div>
      {input}
      {weekday && (
        <span data-date-weekday className="block px-2 pt-0.5 text-[11px] text-neutral-400 dark:text-neutral-500">
          {weekday}
        </span>
      )}
    </div>
  );
}
