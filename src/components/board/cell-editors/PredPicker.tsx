"use client";

import { useMemo, useRef, useState } from "react";
import * as Select from "@radix-ui/react-select";
import { Check, ChevronDown, Search } from "lucide-react";

const NONE = "__none__";

export type PredOption = { id: string; code: string; name: string };

/**
 * The Pred field's item picker, shared by the table cell and the assignment
 * modal so both search the same way.
 *
 * Pred is stored as the target item's id — a WBS code is positional, so an
 * insert above the target would silently re-point the reference at its
 * neighbour. The list still shows the code beside the name, since that is how
 * people refer to these.
 */
export function PredPicker({
  value,
  options,
  parentCode,
  disabled = false,
  triggerClassName,
  onChange,
}: {
  /** The stored Pred value: an item id, or a legacy WBS code. */
  value: string | null;
  options: PredOption[];
  /** Opening the list jumps here — the item's own parent is the most likely
   *  predecessor — without pre-selecting it. */
  parentCode?: string;
  disabled?: boolean;
  triggerClassName?: string;
  onChange: (itemId: string | null) => void;
}) {
  // Boards written before ids (and every spreadsheet import) store a WBS code
  // here; show those against the item they currently resolve to rather than as
  // an unmatched blank.
  const selectedId =
    value === null || value === ""
      ? null
      : (options.find((o) => o.id === value)?.id ?? options.find((o) => o.code === value)?.id ?? null);

  // A group runs to a couple of hundred items, far too many to find anything
  // in by scrolling — so the list filters as you type, on the code and the
  // name alike, since people search by either.
  const [query, setQuery] = useState("");
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return options;
    return options.filter((o) => (o.code + " " + o.name).toLowerCase().includes(needle));
  }, [options, query]);

  const viewportRef = useRef<HTMLDivElement>(null);

  function handleOpenChange(open: boolean) {
    // Each opening starts a fresh search rather than reopening onto whatever
    // the last one was narrowed down to.
    if (!open) {
      setQuery("");
      return;
    }
    if (!parentCode) return;
    // Select.Content mounts into its portal on a render commit after
    // onOpenChange fires, so the target may not exist yet on the very next
    // frame — poll a few frames instead of assuming one rAF is enough.
    let attempts = 0;
    function tryScroll() {
      const target = viewportRef.current?.querySelector('[data-code="' + CSS.escape(parentCode!) + '"]');
      if (target) {
        target.scrollIntoView({ block: "center" });
      } else if (attempts++ < 10) {
        requestAnimationFrame(tryScroll);
      }
    }
    requestAnimationFrame(tryScroll);
  }

  return (
    <Select.Root
      value={selectedId ?? NONE}
      disabled={disabled}
      onValueChange={(v) => onChange(v === NONE ? null : v)}
      onOpenChange={handleOpenChange}
    >
      <Select.Trigger
        className={
          triggerClassName ??
          "flex w-full min-w-0 items-center justify-between gap-1 rounded border-none bg-transparent px-2 py-1 text-left text-sm outline-none hover:bg-neutral-50 dark:hover:bg-neutral-800 focus:bg-white dark:focus:bg-neutral-900 focus:ring-1 focus:ring-blue-400 disabled:opacity-50"
        }
      >
        <span className="min-w-0 flex-1 truncate">
          <Select.Value placeholder="未設定" />
        </span>
        <Select.Icon className="shrink-0 text-neutral-400">
          <ChevronDown size={14} />
        </Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Content
          position="popper"
          sideOffset={4}
          className="z-50 flex max-h-72 w-72 flex-col overflow-hidden rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 shadow-md"
        >
          <div className="flex shrink-0 items-center gap-1.5 border-b border-neutral-100 dark:border-neutral-700 px-2 py-1.5">
            <Search size={13} className="shrink-0 text-neutral-400" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              // Radix Select types-to-jump and moves the highlight with the
              // arrow keys; inside the search box those keystrokes belong to
              // the text field, so they stop here.
              onKeyDown={(e) => {
                if (e.key !== "Escape" && e.key !== "Enter") e.stopPropagation();
              }}
              placeholder="搜尋 WBS 或名稱..."
              className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-neutral-400"
            />
          </div>
          <Select.Viewport ref={viewportRef} className="min-h-0 flex-1 overflow-y-auto p-1">
            <Select.Item
              value={NONE}
              className="flex cursor-pointer items-center justify-between rounded px-2 py-1.5 text-sm outline-none data-[highlighted]:bg-neutral-100 dark:data-[highlighted]:bg-neutral-800"
            >
              <Select.ItemText>未設定</Select.ItemText>
              <Select.ItemIndicator>
                <Check size={14} />
              </Select.ItemIndicator>
            </Select.Item>
            {visible.map((o) => (
              <Select.Item
                key={o.id}
                value={o.id}
                data-code={o.code}
                className="flex cursor-pointer items-center justify-between rounded px-2 py-1.5 text-sm outline-none data-[highlighted]:bg-neutral-100 dark:data-[highlighted]:bg-neutral-800"
              >
                <Select.ItemText>
                  {o.code} {o.name}
                </Select.ItemText>
                <Select.ItemIndicator>
                  <Check size={14} />
                </Select.ItemIndicator>
              </Select.Item>
            ))}
            {visible.length === 0 && (
              <p className="px-2 py-3 text-center text-sm text-neutral-400 dark:text-neutral-500">
                找不到符合的工作項
              </p>
            )}
          </Select.Viewport>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  );
}
