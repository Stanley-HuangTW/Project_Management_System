"use client";

import { useMemo, useState, type ReactNode } from "react";
import * as Popover from "@radix-ui/react-popover";
import { Check, ChevronDown, Search } from "lucide-react";
import { filterOptions } from "@/lib/searchOptions";

export type SelectOption = {
  value: string;
  label: string;
  /** 淡色的補充說明(例如看板名稱),也能被搜尋到。 */
  hint?: string;
  icon?: ReactNode;
  /** 縮排層級,階層式的清單(工作項)用。 */
  indent?: number;
};

/**
 * 可以打字搜尋的下拉選單,用來取代人員、工作項這種動輒幾十上百筆的原生 <select>。
 *
 * 用法跟 <select> 一樣:value 是選項的值,"" 代表沒選;emptyLabel 有給的話,清單最上面多一個
 * 代表「沒選」的選項(例如「全部」「未指定」)。value 一直是 "" 的用法(選了就立刻做事、
 * 按鈕上永遠顯示 placeholder)也行。
 */
export function SearchableSelect({
  options,
  value,
  onChange,
  placeholder = "請選擇",
  emptyLabel,
  disabled,
  className = "",
  title,
}: {
  options: SelectOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  emptyLabel?: string;
  disabled?: boolean;
  /** 加在按鈕上的外觀(邊框、字級、寬度),沿用原本 <select> 的 class 即可。 */
  className?: string;
  title?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const selected = value ? (options.find((o) => o.value === value) ?? null) : null;
  const matches = useMemo(() => filterOptions(options, query), [options, query]);

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) setQuery("");
  }

  function pick(next: string) {
    onChange(next);
    handleOpenChange(false);
  }

  const showEmpty = emptyLabel !== undefined && query.trim() === "";

  return (
    <Popover.Root open={open} onOpenChange={handleOpenChange}>
      <Popover.Trigger asChild>
        <button
          type="button"
          disabled={disabled}
          title={title}
          className={`flex min-w-0 items-center justify-between gap-1 text-left ${className}`}
        >
          <span
            className={`flex min-w-0 flex-1 items-center gap-1.5 truncate ${
              selected || (!value && emptyLabel !== undefined) ? "" : "text-neutral-400 dark:text-neutral-500"
            }`}
          >
            {selected?.icon}
            <span className="truncate">{selected ? selected.label : !value && emptyLabel !== undefined ? emptyLabel : placeholder}</span>
          </span>
          <ChevronDown size={12} className="shrink-0 text-neutral-400 dark:text-neutral-500" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={4}
          className="z-[60] flex max-h-80 w-max min-w-[max(200px,var(--radix-popover-trigger-width))] max-w-[min(90vw,34rem)] flex-col overflow-hidden rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 text-sm shadow-md"
        >
          <div className="flex shrink-0 items-center gap-1.5 border-b border-neutral-100 dark:border-neutral-700 px-2 py-1.5">
            <Search size={13} className="shrink-0 text-neutral-400" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                // 輸入法選字時的 Enter 是確認文字,不是選項目。
                if (e.key === "Enter" && !e.nativeEvent.isComposing && matches.length > 0) {
                  e.preventDefault();
                  pick(matches[0].value);
                }
              }}
              placeholder="搜尋..."
              className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-neutral-400"
            />
          </div>
          <div
            className="min-h-0 flex-1 overflow-y-auto p-1"
            // 常常是從 Modal 裡面開出來的——Modal 會鎖住背景捲動,連帶把這裡的滾輪也擋掉。
            // 手動搬 scrollTop(ItemTreePicker 同一個做法)。
            onWheel={(e) => {
              e.stopPropagation();
              e.currentTarget.scrollTop += e.deltaY;
            }}
          >
            {showEmpty && (
              <button
                type="button"
                onClick={() => pick("")}
                className="flex w-full items-center rounded px-2 py-1.5 text-left text-neutral-500 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800"
              >
                {emptyLabel}
              </button>
            )}
            {matches.map((o) => (
              <button
                key={o.value}
                type="button"
                onClick={() => pick(o.value)}
                style={o.indent ? { paddingLeft: 8 + o.indent * 12 } : undefined}
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-neutral-700 dark:text-neutral-100 hover:bg-neutral-100 dark:hover:bg-neutral-800"
              >
                {o.icon}
                <span className="min-w-0 flex-1 truncate">{o.label}</span>
                {o.hint && <span className="shrink-0 text-xs text-neutral-400 dark:text-neutral-500">{o.hint}</span>}
                {o.value === value && <Check size={14} className="shrink-0 text-blue-600" />}
              </button>
            ))}
            {matches.length === 0 && (
              <p className="px-2 py-3 text-center text-neutral-400 dark:text-neutral-500">找不到符合的項目</p>
            )}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
