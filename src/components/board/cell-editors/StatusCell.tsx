"use client";

import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { getStatusOptions } from "@/types/column";
import { useRecordedCellSave } from "./useCellSave";

export function StatusCell({
  boardId,
  itemId,
  columnId,
  value,
  options,
  compact = false,
}: {
  boardId: string;
  itemId: string;
  columnId: string;
  value: string | null;
  options: unknown;
  /** 小標籤的樣子(甘特圖項目名稱旁用),不是撐滿儲存格的長條。 */
  compact?: boolean;
}) {
  const statuses = getStatusOptions(options);
  const save = useRecordedCellSave();
  const current = statuses.find((s) => s.id === value);

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          title={current?.label}
          className={
            compact
              ? "shrink-0 whitespace-nowrap rounded px-1.5 text-[10px] font-medium leading-4 text-white"
              : "flex h-7 w-full items-center truncate rounded px-2 text-xs font-medium text-white"
          }
          style={{ backgroundColor: current?.color ?? "#c4c4c4" }}
        >
          {current?.label ?? "設定狀態"}
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="start"
          className="z-50 min-w-[160px] rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 p-1 shadow-md"
        >
          {statuses.map((option) => (
            <DropdownMenu.Item
              key={option.id}
              onSelect={() =>
                save({ boardId, itemId, columnId, before: value, after: option.id })
              }
              className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm outline-none hover:bg-neutral-100 dark:hover:bg-neutral-800"
            >
              <span
                className="h-3 w-3 shrink-0 rounded-sm"
                style={{ backgroundColor: option.color }}
              />
              {option.label}
            </DropdownMenu.Item>
          ))}
          <DropdownMenu.Separator className="my-1 h-px bg-neutral-200 dark:bg-neutral-700" />
          <DropdownMenu.Item
            onSelect={() => save({ boardId, itemId, columnId, before: value, after: null })}
            className="cursor-pointer rounded px-2 py-1.5 text-sm text-neutral-500 dark:text-neutral-400 outline-none hover:bg-neutral-100 dark:hover:bg-neutral-800"
          >
            清除
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
