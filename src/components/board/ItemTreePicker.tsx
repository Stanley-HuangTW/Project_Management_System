"use client";

import { useMemo, useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { Check, ChevronDown, ChevronRight } from "lucide-react";
import type { ItemData } from "@/types/board";

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
  items: ItemData[];
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

  const childrenOf = useMemo(() => {
    const map = new Map<string, ItemData[]>();
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
    const out: { item: ItemData; depth: number; hasChildren: boolean }[] = [];
    const walk = (nodes: ItemData[], depth: number) => {
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
    if (!next) return;
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
          className="z-50 max-h-72 w-80 overflow-y-auto rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 p-1 shadow-md"
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
          {rows.map(({ item, depth, hasChildren }) => (
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
                <span className="min-w-0 flex-1 truncate">
                  <span className="mr-1 text-neutral-400 dark:text-neutral-500">
                    {wbsByItemId.get(item.id) ?? ""}
                  </span>
                  {item.name}
                </span>
                {item.id === value && <Check size={14} className="shrink-0" />}
              </button>
            </div>
          ))}
          {rows.length === 0 && (
            <p className="px-2 py-3 text-center text-sm text-neutral-400 dark:text-neutral-500">沒有可選的工作項</p>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
