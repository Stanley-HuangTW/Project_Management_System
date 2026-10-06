"use client";

import { useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { Check, ChevronDown, Search } from "lucide-react";
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
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const selected = users.find((u) => u.id === selectedId) ?? null;

  const needle = query.trim().toLowerCase();
  const matches = needle ? users.filter((u) => u.name.toLowerCase().includes(needle)) : users;

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) setQuery("");
  }

  function pick(userId: string | null) {
    onSelect(userId);
    handleOpenChange(false);
  }

  // 用 Popover 而不是 DropdownMenu:選單項目會在滑鼠移過去時搶走焦點、
  // 還會攔截打字的按鍵(typeahead),搜尋框根本打不了字。
  return (
    <Popover.Root open={open} onOpenChange={handleOpenChange}>
      <Popover.Trigger asChild>
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
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={4}
          className="z-50 flex max-h-72 min-w-[200px] flex-col overflow-hidden rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 shadow-md"
        >
          <div className="flex shrink-0 items-center gap-1.5 border-b border-neutral-100 dark:border-neutral-700 px-2 py-1.5">
            <Search size={13} className="shrink-0 text-neutral-400" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                // 輸入法選字時的 Enter 是確認文字,不是選人。
                if (e.key === "Enter" && !e.nativeEvent.isComposing && matches.length > 0) {
                  e.preventDefault();
                  pick(matches[0].id);
                }
              }}
              placeholder="搜尋姓名..."
              className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-neutral-400"
            />
          </div>
          <div
            className="min-h-0 flex-1 overflow-y-auto p-1"
            // 常常是從 Modal 裡面開出來的——Modal 會鎖住背景捲動,連帶把這裡的
            // 滾輪也擋掉。手動搬 scrollTop(ItemTreePicker 同一個做法)。
            onWheel={(e) => {
              e.stopPropagation();
              e.currentTarget.scrollTop += e.deltaY;
            }}
          >
            {unassignedLabel && !needle && (
              <button
                type="button"
                onClick={() => pick(null)}
                className="flex w-full items-center rounded px-2 py-1.5 text-left text-sm text-neutral-500 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800"
              >
                {unassignedLabel}
              </button>
            )}
            {matches.map((u) => (
              <button
                key={u.id}
                type="button"
                onClick={() => pick(u.id)}
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-neutral-700 dark:text-neutral-100 hover:bg-neutral-100 dark:hover:bg-neutral-800"
              >
                <Avatar name={u.name} avatarUrl={u.avatarUrl} size={20} />
                <span className="min-w-0 flex-1 truncate">{u.name}</span>
                {u.id === selectedId && <Check size={14} className="shrink-0 text-blue-600" />}
              </button>
            ))}
            {needle && matches.length === 0 && (
              <p className="px-2 py-3 text-center text-sm text-neutral-400 dark:text-neutral-500">
                找不到符合的人員
              </p>
            )}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
