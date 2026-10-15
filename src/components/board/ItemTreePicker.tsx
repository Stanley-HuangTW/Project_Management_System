"use client";

import { useMemo, useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { Check, ChevronDown, ChevronRight, Search } from "lucide-react";
import type { ItemData } from "@/types/board";

/** 選項目只需要這三個欄位——別的看板的項目樹(只有這幾個欄位)也能放進來。 */
type PickerItem = Pick<ItemData, "id" | "name" | "parentId">;

/**
 * Picks one work item from a collapsible WBS tree instead of a flat
 * `<select>` — a board's few hundred items in one long list give no sense of
 * which phase or subtree something belongs to, and there is no code hint at
 * all without the WBS prefix.
 */
export function ItemTreePicker({
  items,
  wbsByItemId,
  value,
  onChange,
  placeholder = "未指定",
  disabled = false,
  className,
}: {
  items: PickerItem[];
  wbsByItemId: Map<string, string>;
  /** "" means nothing picked. */
  value: string;
  onChange: (id: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");

  // 打字找的時候直接列出符合的項目,不管它在樹的哪一層 —— 樹狀反而礙事,
  // 使用者要的是直接找到那一個。
  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return null;
    return items.filter((i) =>
      `${wbsByItemId.get(i.id) ?? ""} ${i.name}`.toLowerCase().includes(needle)
    );
  }, [items, wbsByItemId, query]);

  const childrenOf = useMemo(() => {
    const map = new Map<string, PickerItem[]>();
    for (const item of items) {
      const key = item.parentId ?? "";
      const list = map.get(key);
      if (list) list.push(item);
      else map.set(key, [item]);
    }
    return map;
  }, [items]);

  // 父項不在這份清單裡(例如 BoardGates 只給有子項的「階段」)就當作根節點。
  const ids = useMemo(() => new Set(items.map((i) => i.id)), [items]);
  const roots = useMemo(() => items.filter((i) => !i.parentId || !ids.has(i.parentId)), [items, ids]);

  const rows = useMemo(() => {
    const out: { item: PickerItem; depth: number; hasChildren: boolean }[] = [];
    const walk = (nodes: PickerItem[], depth: number) => {
      for (const node of nodes) {
        const kids = childrenOf.get(node.id) ?? [];
        out.push({ item: node, depth, hasChildren: kids.length > 0 });
        if (kids.length > 0 && !collapsed.has(node.id)) walk(kids, depth + 1);
      }
    };
    walk(roots, 0);
    return out;
  }, [roots, childrenOf, collapsed]);

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      setQuery("");
      return;
    }
    // 展開目前選中那一項的祖先鏈,其餘全部收起來。
    const chain = new Set<string>();
    if (value) {
      const parentOf = new Map(items.map((i) => [i.id, i.parentId ?? null]));
      let cursor: string | null = value;
      const seen = new Set<string>();
      while (cursor && !seen.has(cursor)) {
        seen.add(cursor);
        cursor = parentOf.get(cursor) ?? null;
        if (cursor) chain.add(cursor);
      }
    }
    const parents = new Set<string>();
    for (const i of items) if (i.parentId) parents.add(i.parentId);
    for (const id of chain) parents.delete(id);
    setCollapsed(parents);
  }

  const selected = value ? items.find((i) => i.id === value) : undefined;

  const displayRows = useMemo(
    () => (matches !== null ? matches.map((item) => ({ item, depth: 0, hasChildren: false })) : rows),
    [matches, rows]
  );

  return (
    <Popover.Root open={open} onOpenChange={handleOpenChange}>
      <Popover.Trigger
        type="button"
        disabled={disabled}
        className={
          className ??
          "flex items-center justify-between gap-1 rounded-md border border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-900 px-2 py-1 text-left text-sm outline-none focus:border-blue-500 disabled:opacity-50"
        }
      >
        <span className={`min-w-0 flex-1 truncate ${selected ? "" : "text-neutral-400 dark:text-neutral-500"}`}>
          {selected ? `${wbsByItemId.get(selected.id) ?? ""} ${selected.name}` : placeholder}
        </span>
        <ChevronDown size={14} className="shrink-0 text-neutral-400" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={4}
          collisionPadding={8}
          className="z-50 flex max-h-80 w-[34rem] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 shadow-md"
        >
          <div className="flex shrink-0 items-center gap-1.5 border-b border-neutral-100 dark:border-neutral-700 px-2 py-1.5">
            <Search size={13} className="shrink-0 text-neutral-400" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜尋 WBS 或名稱..."
              className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-neutral-400"
            />
          </div>
          <div
            className="min-h-0 flex-1 overflow-y-auto p-1"
            // 這個選單常常是從一個 Modal 裡面開出來的——Modal 自己會鎖住背景
            // 捲動,連帶把這裡的滾輪事件也一起擋掉,滑鼠滾輪在清單上完全沒
            // 反應。直接手動搬 scrollTop,不依賴瀏覽器原生的捲動行為。
            onWheel={(e) => {
              e.stopPropagation();
              e.currentTarget.scrollTop += e.deltaY;
            }}
          >
            <button
              type="button"
              onClick={() => {
                onChange("");
                setOpen(false);
              }}
              className="flex w-full items-center rounded px-2 py-1.5 text-left text-sm text-neutral-500 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800"
            >
              {placeholder}
            </button>
            {displayRows.map(({ item, depth, hasChildren }) => (
              <div key={item.id} className="flex items-center">
                <span style={{ width: depth * 12 }} className="shrink-0" />
                {hasChildren ? (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setCollapsed((prev) => {
                        const next = new Set(prev);
                        if (next.has(item.id)) next.delete(item.id);
                        else next.add(item.id);
                        return next;
                      });
                    }}
                    aria-label={collapsed.has(item.id) ? "展開" : "收合"}
                    className="shrink-0 rounded p-0.5 text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-700"
                  >
                    {collapsed.has(item.id) ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                  </button>
                ) : (
                  <span className="w-[18px] shrink-0" />
                )}
                <button
                  type="button"
                  onClick={() => {
                    onChange(item.id);
                    setOpen(false);
                  }}
                  className={`flex min-w-0 flex-1 items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-neutral-100 dark:hover:bg-neutral-800 ${
                    item.id === value ? "text-blue-600" : "text-neutral-700 dark:text-neutral-100"
                  }`}
                >
                  <span className="min-w-0 flex-1 break-words">
                    <span className="mr-1 text-neutral-400 dark:text-neutral-500">
                      {wbsByItemId.get(item.id) ?? ""}
                    </span>
                    {item.name}
                  </span>
                  {item.id === value && <Check size={14} className="shrink-0" />}
                </button>
              </div>
            ))}
            {displayRows.length === 0 && (
              <p className="px-2 py-3 text-center text-sm text-neutral-400 dark:text-neutral-500">
                {matches !== null ? "找不到符合的工作項" : "沒有可選的工作項"}
              </p>
            )}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
