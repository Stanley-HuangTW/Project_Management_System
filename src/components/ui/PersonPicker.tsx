"use client";

import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { ChevronDown } from "lucide-react";
import { Avatar } from "./Avatar";
import type { UserOption } from "@/types/board";

export function PersonPicker({
  users,
  selectedId,
  onSelect,
  placeholder = "選擇人員...",
  unassignedLabel,
}: {
  users: UserOption[];
  selectedId: string | null;
  onSelect: (userId: string | null) => void;
  placeholder?: string;
  unassignedLabel?: string;
}) {
  const selected = users.find((u) => u.id === selectedId) ?? null;

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          className="flex w-full items-center gap-2 rounded px-2 py-1 text-sm outline-none hover:bg-neutral-100 dark:hover:bg-neutral-800"
        >
          {selected ? (
            <>
              <Avatar name={selected.name} avatarUrl={selected.avatarUrl} size={20} />
              <span className="min-w-0 flex-1 truncate text-left">{selected.name}</span>
            </>
          ) : (
            <span className="min-w-0 flex-1 truncate text-left text-neutral-400 dark:text-neutral-500">{placeholder}</span>
          )}
          <ChevronDown size={12} className="shrink-0 text-neutral-400 dark:text-neutral-500" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="start"
          className="z-50 max-h-64 min-w-[160px] overflow-y-auto rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 p-1 shadow-md"
          onWheel={(e) => {
            e.stopPropagation();
            e.currentTarget.scrollTop += e.deltaY;
          }}
        >
          {unassignedLabel && (
            <DropdownMenu.Item
              onSelect={() => onSelect(null)}
              className="cursor-pointer rounded px-2 py-1.5 text-sm text-neutral-500 dark:text-neutral-400 outline-none hover:bg-neutral-100 dark:hover:bg-neutral-800"
            >
              {unassignedLabel}
            </DropdownMenu.Item>
          )}
          {users.map((u) => (
            <DropdownMenu.Item
              key={u.id}
              onSelect={() => onSelect(u.id)}
              className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm text-neutral-700 dark:text-neutral-100 outline-none hover:bg-neutral-100 dark:hover:bg-neutral-800"
            >
              <Avatar name={u.name} avatarUrl={u.avatarUrl} size={20} />
              <span className="min-w-0 flex-1 truncate">{u.name}</span>
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
