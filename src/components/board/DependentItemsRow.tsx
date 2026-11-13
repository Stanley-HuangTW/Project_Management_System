"use client";

import type { DependentSummary } from "@/lib/predecessorLink";
import { withWeekday } from "@/lib/weekdayLabel";

/**
 * The "相關項目" list: who is scheduled off THIS item. The Pred field only
 * shows what an item points at, so without this there is no way to see what
 * would move if this item's dates changed — or what would be cut loose if it
 * were deleted.
 */
export function DependentItemsRow({
  dependents,
  className = "border-b border-neutral-100 dark:border-neutral-700 px-4 py-2.5",
}: {
  dependents: DependentSummary[];
  /** The row styling of whichever list this sits in. */
  className?: string;
}) {
  return (
    <div className={className}>
      <div className="flex items-start justify-between gap-3">
        <span className="shrink-0 text-xs text-neutral-400 dark:text-neutral-500">相關項目</span>
        {dependents.length === 0 ? (
          <span className="text-sm text-neutral-500 dark:text-neutral-400">尚無項目以此為前置</span>
        ) : (
          <ul className="min-w-0 flex-1 space-y-1 text-right">
            {dependents.map((d) => (
              <li key={d.itemId} className="text-sm text-neutral-800 dark:text-neutral-100">
                <span className="break-words">
                  {d.wbsCode} {d.name}
                </span>
                <span className="ml-2 whitespace-nowrap text-xs text-neutral-500 dark:text-neutral-400">
                  {d.link ?? "未設 Link"}
                  {d.start && d.end ? `・${withWeekday(d.start)} → ${withWeekday(d.end)}` : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
