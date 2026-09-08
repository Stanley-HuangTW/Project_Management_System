"use client";

import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { MoreHorizontal } from "lucide-react";
import { ReactNode } from "react";

type RowMenuProps = {
  children: ReactNode;
  /** Overrides the default bare-icon trigger — for places like the board
   *  header where the menu sits among full-sized bordered buttons. */
  triggerClassName?: string;
  /** Overrides the default "…" glyph — the Gantt hangs the same menu off the
   *  row's existing "+", where a second icon would just be clutter. */
  icon?: ReactNode;
  /** Announced on the trigger; defaults to the menu's usual purpose. */
  label?: string;
};

export function RowMenu({ children, triggerClassName, icon, label }: RowMenuProps) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          className={
            triggerClassName ??
            "rounded p-1 text-neutral-400 dark:text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800 hover:text-neutral-700 dark:hover:text-neutral-100"
          }
          aria-label={label ?? "更多操作"}
        >
          {icon ?? <MoreHorizontal size={16} />}
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          className="z-50 min-w-[140px] rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 p-1 shadow-md"
        >
          {children}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

export function RowMenuItem({
  onSelect,
  danger,
  children,
}: {
  onSelect: () => void;
  danger?: boolean;
  children: ReactNode;
}) {
  return (
    <DropdownMenu.Item
      onSelect={onSelect}
      className={`cursor-pointer rounded px-2 py-1.5 text-sm outline-none hover:bg-neutral-100 dark:hover:bg-neutral-800 ${
        danger ? "text-red-600" : "text-neutral-700 dark:text-neutral-100"
      }`}
    >
      {children}
    </DropdownMenu.Item>
  );
}
