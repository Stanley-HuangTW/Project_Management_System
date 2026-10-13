"use client";

import { useRef, useState } from "react";
import { StickyNote } from "lucide-react";

/**
 * 樣機計畫表上的一格:直接在表格上填台數。
 *
 * 點進去(或用 Tab 走到)就能打數字:Enter 或點到別處存檔,Esc 放棄;清空存成 0。
 * 備註還是可以改——格子左邊那顆小圖示(有備註就是備註文字本身)。
 * 唯讀的人看到的跟以前一樣:數字加備註,不能點。
 */
export function ProtoQtyCell({
  qty,
  note,
  canEdit,
  label,
  product,
  unit,
  onCommitQty,
  onEditNote,
}: {
  qty: number;
  note: string;
  canEdit: boolean;
  /** 給螢幕閱讀器與提示用:「產品 / 用途 / 階段」。 */
  label: string;
  product: string;
  unit: string;
  /** 存台數。回傳 false = 沒存成(格子會退回原本的數字)。 */
  onCommitQty: (qty: number) => Promise<boolean>;
  /** 改備註。傳目前這格的台數(可能還沒從伺服器載回來),存備註時才不會把剛打的數字蓋回去。 */
  onEditNote: (currentQty: number) => void;
}) {
  // 目前顯示的台數。伺服器的資料重新載入後(qty 變了)跟上。
  const [value, setValue] = useState(qty);
  const [prevQty, setPrevQty] = useState(qty);
  if (qty !== prevQty) {
    setPrevQty(qty);
    setValue(qty);
  }
  // 正在打的字;null = 沒在編輯。
  const [text, setText] = useState<string | null>(null);
  const cancelled = useRef(false);

  if (!canEdit) {
    return (
      <span title={note || undefined}>
        {qty > 0 ? (
          <span className="text-blue-700 dark:text-blue-300">
            {qty}
            {note && <span className="ml-1 text-[10px] text-neutral-400 dark:text-neutral-500">({note})</span>}
          </span>
        ) : (
          <span className="text-neutral-300 dark:text-neutral-700">·</span>
        )}
      </span>
    );
  }

  const shown = value > 0 ? String(value) : "";

  async function commit() {
    const draft = text;
    setText(null);
    if (draft === null) return;
    const next = draft === "" ? 0 : Number(draft);
    if (next === value) return;
    const previous = value;
    setValue(next);
    if (!(await onCommitQty(next))) setValue(previous);
  }

  const noteButton =
    "max-w-[8rem] truncate rounded px-1 text-[10px] text-neutral-400 hover:text-blue-600 dark:text-neutral-500";

  return (
    // -mr 抵掉輸入框的左右留白(1px 框線 + 6px),讓打的數字跟下面的小計、合計對齊右邊。
    <div className="group/cell -mr-[7px] flex items-center justify-end gap-1">
      {note ? (
        <button type="button" tabIndex={-1} onClick={() => onEditNote(value)} title={`備註:${note}(點一下修改)`} className={noteButton}>
          ({note})
        </button>
      ) : (
        <button
          type="button"
          tabIndex={-1}
          onClick={() => onEditNote(value)}
          title="加備註(例如 mock up)"
          aria-label={`${label} 加備註`}
          className="rounded p-0.5 text-neutral-300 opacity-0 hover:text-blue-600 focus-visible:opacity-100 group-hover/cell:opacity-100 dark:text-neutral-600"
        >
          <StickyNote size={11} />
        </button>
      )}
      <input
        type="text"
        inputMode="numeric"
        maxLength={4}
        data-proto-cell=""
        data-product={product}
        data-unit={unit}
        aria-label={`${label} 台數`}
        value={text ?? shown}
        placeholder="·"
        onFocus={(e) => {
          setText(shown);
          e.currentTarget.select();
        }}
        onChange={(e) => setText(e.target.value.replace(/\D/g, ""))}
        onBlur={() => {
          if (cancelled.current) {
            cancelled.current = false;
            setText(null);
            return;
          }
          void commit();
        }}
        onKeyDown={(e) => {
          // 輸入法選字時的 Enter 是確認文字,不是存檔。
          if (e.key === "Enter" && !e.nativeEvent.isComposing) e.currentTarget.blur();
          else if (e.key === "Escape") {
            cancelled.current = true;
            e.currentTarget.blur();
          }
        }}
        className={`w-14 rounded border border-transparent bg-transparent px-1.5 py-0.5 text-right tabular-nums outline-none placeholder:text-neutral-300 hover:border-neutral-200 focus:border-blue-500 focus:bg-white dark:placeholder:text-neutral-700 dark:hover:border-neutral-700 dark:focus:bg-neutral-900 ${
          value > 0 ? "text-blue-700 dark:text-blue-300" : ""
        }`}
      />
    </div>
  );
}
