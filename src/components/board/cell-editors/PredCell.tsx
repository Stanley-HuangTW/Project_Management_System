"use client";

import { useRef } from "react";
import * as Select from "@radix-ui/react-select";
import { Check, ChevronDown } from "lucide-react";
import { upsertCellValue } from "@/lib/actions/cell";
import { computeWbsCodes } from "@/lib/wbs";
import { useCellSave } from "./useCellSave";
import type { ItemData } from "@/types/board";

const NONE = "__none__";

/** Pred is stored as the target item's id — a WBS code is positional, so an
 *  insert above the target would silently re-point the reference at its
 *  neighbour. The list shows the code alongside the name, since that is how
 *  people refer to these, same as AssignmentModal's Pred picker.
 *  A native <select> can't be scrolled to an arbitrary option without
 *  selecting it, so this uses Radix Select instead: opening the list jumps
 *  to the item's own parent (the most likely predecessor) without pre-
 *  selecting it — Pred itself is left for the user to actually choose. */
export function PredCell({
  boardId,
  itemId,
  columnId,
  value,
  groupItems,
  wbsCodes,
}: {
  boardId: string;
  itemId: string;
  columnId: string;
  value: string | null;
  groupItems: ItemData[];
  /** Precomputed via computeWbsCodes(groupItems) by a memoized ancestor
   *  (GroupSection) — pass this on the table's per-row hot path so 2000
   *  rows don't each redo an O(n) WBS-numbering pass over the whole group.
   *  Falls back to computing it locally for lower-frequency callers (the
   *  item detail modal, opened one item at a time) that don't have one. */
  wbsCodes?: Map<string, string>;
}) {
  const codes = wbsCodes ?? computeWbsCodes(groupItems);
  const options = groupItems
    .filter((i) => i.id !== itemId)
    .map((i) => ({ id: i.id, code: codes.get(i.id) ?? "", name: i.name }))
    .filter((o) => o.code)
    .sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));

  // Boards written before the switch (and every spreadsheet import) store a
  // WBS code here; show those against the item they currently resolve to
  // rather than as an unmatched blank.
  const selectedId =
    value === null
      ? null
      : (options.find((o) => o.id === value)?.id ?? options.find((o) => o.code === value)?.id ?? null);

  const currentItem = groupItems.find((i) => i.id === itemId);
  const parentCode = currentItem?.parentId ? codes.get(currentItem.parentId) : undefined;

  const viewportRef = useRef<HTMLDivElement>(null);
  const save = useCellSave();

  function handleOpenChange(open: boolean) {
    if (!open || !parentCode) return;
    // Select.Content mounts into its portal on a render commit after
    // onOpenChange fires, so the target may not exist yet on the very next
    // frame — poll a few frames instead of assuming one rAF is enough.
    let attempts = 0;
    function tryScroll() {
      const target = viewportRef.current?.querySelector(`[data-code="${CSS.escape(parentCode!)}"]`);
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
      onValueChange={(v) => save(() => upsertCellValue(boardId, itemId, columnId, v === NONE ? null : v))}
      onOpenChange={handleOpenChange}
    >
      <Select.Trigger className="flex w-full min-w-0 items-center justify-between gap-1 rounded border-none bg-transparent px-2 py-1 text-left text-sm outline-none hover:bg-neutral-50 dark:hover:bg-neutral-800 focus:bg-white dark:focus:bg-neutral-900 focus:ring-1 focus:ring-blue-400">
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
          className="z-50 max-h-72 overflow-hidden rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 shadow-md"
        >
          <Select.Viewport ref={viewportRef} className="p-1">
            <Select.Item
              value={NONE}
              className="flex cursor-pointer items-center justify-between rounded px-2 py-1.5 text-sm outline-none data-[highlighted]:bg-neutral-100 dark:data-[highlighted]:bg-neutral-800"
            >
              <Select.ItemText>未設定</Select.ItemText>
              <Select.ItemIndicator>
                <Check size={14} />
              </Select.ItemIndicator>
            </Select.Item>
            {options.map((o) => (
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
          </Select.Viewport>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  );
}
