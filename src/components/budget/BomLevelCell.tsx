"use client";

import { useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

/**
 * BOM 一列的階層(BOM LEVEL,1 = 最上層):數字可以直接改,左右兩個按鈕是升階 / 降階。
 * 規則在 lib/bomLevel.ts:底下的子項目整串跟著走;升階時後面原本同層的列變成它的子項目;最多比前一列深一層。
 * 改不成(例如太深)由 onSet 回 false,數字就退回原本的。階層變了,外面會用新的 level 重新掛上這個元件(key)。
 */
export function BomLevelCell({
  level,
  maxLevel,
  canEdit,
  onSet,
}: {
  level: number;
  /** 這一列最深可以放到第幾層(前一列的階層 + 1)。 */
  maxLevel: number;
  canEdit: boolean;
  /** 回傳 false = 沒改成(原因外面已經說明了)。 */
  onSet: (level: number) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState(String(level));
  /** 按 Esc 放棄:緊接著的失焦不能又把打到一半的數字送出去。 */
  const cancelled = useRef(false);

  async function commit() {
    if (cancelled.current) {
      cancelled.current = false;
      return;
    }
    const text = draft.trim();
    if (text === String(level)) return;
    if (!/^\d+$/.test(text)) {
      setDraft(String(level));
      return;
    }
    const ok = await onSet(Number(text));
    if (!ok) setDraft(String(level));
  }

  const arrow =
    "rounded p-0.5 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 disabled:opacity-25 disabled:hover:bg-transparent disabled:hover:text-neutral-400 dark:text-neutral-500 dark:hover:bg-neutral-800 dark:hover:text-neutral-200";

  return (
    <div data-bom-level-cell className="flex items-center justify-center gap-0.5">
      {canEdit && (
        <button
          type="button"
          data-bom-level-left
          tabIndex={-1}
          disabled={level <= 1}
          onClick={() => void onSet(level - 1)}
          title="升階:往外一層(底下的子項目一起;後面原本同層的列會變成它的子項目)"
          aria-label="升階"
          className={arrow}
        >
          <ChevronLeft size={13} />
        </button>
      )}
      <input
        data-bom-level-input
        aria-label="BOM LEVEL"
        inputMode="numeric"
        value={draft}
        disabled={!canEdit}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => void commit()}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") {
            cancelled.current = true;
            setDraft(String(level));
            e.currentTarget.blur();
          }
        }}
        className="w-9 rounded border border-transparent bg-transparent px-1 py-1 text-center text-sm tabular-nums outline-none hover:border-neutral-200 focus:border-blue-500 disabled:border-transparent dark:hover:border-neutral-700"
      />
      {canEdit && (
        <button
          type="button"
          data-bom-level-right
          tabIndex={-1}
          disabled={level >= maxLevel}
          onClick={() => void onSet(level + 1)}
          title="降階:變成前一列的子項目(底下的子項目一起)"
          aria-label="降階"
          className={arrow}
        >
          <ChevronRight size={13} />
        </button>
      )}
    </div>
  );
}
