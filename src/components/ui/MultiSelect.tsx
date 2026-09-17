"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Search, X } from "lucide-react";

export type MultiSelectOption = { id: string; name: string; hint?: string };

/**
 * 複選下拉。
 *
 * 取代「把二十幾個人名全部攤成一排藥丸」那種做法:七個角色 × 二十幾個人
 * 就是一百多顆按鈕,要找一個人得用眼睛掃過整面牆,而且畫面高度全被它吃掉。
 *
 * 選好的人留在收合狀態下看得到(那是最常要回答的問題:現在是誰?),打開
 * 才是完整清單。
 */
export function MultiSelect({
  options,
  selectedIds,
  disabled = false,
  placeholder = "未指定",
  emptyText = "沒有可選的人",
  /** 收合時最多列幾個名字,超過就用「…等 N 人」收尾。 */
  summaryLimit = 4,
  footer,
  onToggle,
}: {
  options: MultiSelectOption[];
  selectedIds: Set<string>;
  disabled?: boolean;
  placeholder?: string;
  emptyText?: string;
  summaryLimit?: number;
  /** 掛在清單底下的東西,例如「顯示其他部門」那個開關。 */
  footer?: React.ReactNode;
  onToggle: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const boxRef = useRef<HTMLDivElement>(null);

  // 點到外面就收起來。沒有這個,畫面上會同時開著好幾個清單。
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const selected = options.filter((o) => selectedIds.has(o.id));
  // 被選到的人如果不在目前的清單裡(例如換了部門篩選),仍然要算進數量,
  // 不然看起來像沒選 —— 但實際上存著。
  const hiddenSelectedCount = selectedIds.size - selected.length;

  const matched = query.trim()
    ? options.filter((o) => o.name.toLowerCase().includes(query.trim().toLowerCase()))
    : options;

  const summary =
    selectedIds.size === 0
      ? placeholder
      : [
          ...selected.slice(0, summaryLimit).map((o) => o.name),
          selected.length > summaryLimit ? `等 ${selectedIds.size} 人` : "",
          hiddenSelectedCount > 0 && selected.length <= summaryLimit
            ? `+${hiddenSelectedCount} 人(不在目前清單)`
            : "",
        ]
          .filter(Boolean)
          .join("、");

  return (
    <div ref={boxRef} className="relative min-w-0 flex-1">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className={`flex w-full items-center gap-1 rounded-md border px-2 py-1 text-left text-xs disabled:opacity-50 ${
          selectedIds.size > 0
            ? "border-neutral-300 text-neutral-800 dark:border-neutral-600 dark:text-neutral-100"
            : "border-neutral-200 text-neutral-400 dark:border-neutral-700 dark:text-neutral-500"
        } bg-white hover:border-neutral-400 dark:bg-neutral-900`}
      >
        <span className="min-w-0 flex-1 truncate">{summary}</span>
        {selectedIds.size > 0 && (
          <span className="shrink-0 rounded-full bg-neutral-100 px-1.5 text-[10px] text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
            {selectedIds.size}
          </span>
        )}
        <ChevronDown size={13} className="shrink-0 text-neutral-400" />
      </button>

      {open && (
        <div className="absolute left-0 z-40 mt-1 w-full min-w-[220px] rounded-md border border-neutral-200 bg-white shadow-lg dark:border-neutral-700 dark:bg-neutral-900">
          <div className="flex items-center gap-1 border-b border-neutral-100 px-2 py-1.5 dark:border-neutral-700">
            <Search size={12} className="shrink-0 text-neutral-400" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜尋姓名"
              className="min-w-0 flex-1 bg-transparent text-xs outline-none"
            />
            {query && (
              <button type="button" onClick={() => setQuery("")} aria-label="清除搜尋">
                <X size={12} className="text-neutral-400 hover:text-neutral-700" />
              </button>
            )}
          </div>

          <div className="max-h-56 overflow-y-auto py-1">
            {matched.length === 0 ? (
              <p className="px-3 py-2 text-xs text-neutral-400 dark:text-neutral-500">
                {query.trim() ? "找不到符合的人" : emptyText}
              </p>
            ) : (
              matched.map((o) => {
                const active = selectedIds.has(o.id);
                return (
                  <button
                    key={o.id}
                    type="button"
                    onClick={() => onToggle(o.id)}
                    className="flex w-full items-center gap-2 px-2 py-1 text-left text-xs hover:bg-neutral-50 dark:hover:bg-neutral-800"
                  >
                    <span
                      className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border ${
                        active
                          ? "border-blue-600 bg-blue-600 text-white"
                          : "border-neutral-300 dark:border-neutral-600"
                      }`}
                    >
                      {active && <Check size={10} />}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-neutral-800 dark:text-neutral-100">
                      {o.name}
                    </span>
                    {o.hint && (
                      <span className="shrink-0 text-[10px] text-neutral-400 dark:text-neutral-500">
                        {o.hint}
                      </span>
                    )}
                  </button>
                );
              })
            )}
          </div>

          {footer && (
            <div className="border-t border-neutral-100 px-2 py-1.5 dark:border-neutral-700">{footer}</div>
          )}
        </div>
      )}
    </div>
  );
}
