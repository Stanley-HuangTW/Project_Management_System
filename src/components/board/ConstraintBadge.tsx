"use client";

import { CalendarClock } from "lucide-react";
import type { ItemData } from "@/types/board";
import { CONSTRAINT_LABELS } from "@/lib/constraints";

/**
 * A pin beside the name of any item carrying a 日期約束.
 *
 * The constraint lives on the Item row, not in a Column, so it cannot be a
 * table column of its own — but without a mark on the row you cannot tell,
 * scanning a board of 200 items, which three of them are nailed to a date.
 */
export function ConstraintBadge({
  item,
}: {
  item: Pick<ItemData, "constraintType" | "constraintDate">;
}) {
  if (!item.constraintType || !item.constraintDate) return null;
  const label = `${CONSTRAINT_LABELS[item.constraintType]} ${item.constraintDate}`;
  return (
    <span title={label} aria-label={label} className="shrink-0 text-amber-600 dark:text-amber-400">
      <CalendarClock size={12} />
    </span>
  );
}
