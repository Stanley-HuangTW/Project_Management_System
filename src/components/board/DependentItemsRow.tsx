"use client";

import type { DependentSummary } from "@/lib/predecessorLink";

/**
 * The "相關項目" list, in two parts so they can't be mistaken for each other:
 *  - 前置(此項目參照):what THIS item's Pred field points at — what it waits on;
 *  - 後續(以此為前置):who is scheduled off this item — what would move if its
 *    dates changed, or be cut loose if it were deleted.
 * The Pred field only shows the first, so without the second there is no way to
 * see the effect of changing this item.
 */
export function DependentItemsRow({
  dependents,
  predecessors = [],
  className = "border-b border-neutral-100 dark:border-neutral-700 px-4 py-2.5",
}: {
  /** 後續:以這個項目為前置的項目。 */
  dependents: DependentSummary[];
  /** 前置:這個項目 Pred 欄指到的項目(在同一組裡找得到的)。 */
  predecessors?: DependentSummary[];
  /** The row styling of whichever list this sits in. */
  className?: string;
}) {
  return (
    <div className={className}>
      <div className="flex items-start justify-between gap-3">
        <span className="shrink-0 text-xs text-neutral-400 dark:text-neutral-500">相關項目</span>
        <div className="min-w-0 flex-1 space-y-2 text-right">
          <RelatedList
            title="前置(此項目參照)"
            kind="predecessors"
            items={predecessors}
            empty="沒有參照其他項目"
          />
          <RelatedList
            title="後續(以此為前置)"
            kind="dependents"
            items={dependents}
            empty="尚無項目以此為前置"
          />
        </div>
      </div>
    </div>
  );
}

function RelatedList({
  title,
  kind,
  items,
  empty,
}: {
  title: string;
  kind: "predecessors" | "dependents";
  items: DependentSummary[];
  empty: string;
}) {
  return (
    <div data-related-list={kind}>
      <div className="text-xs font-medium text-neutral-500 dark:text-neutral-400">
        {title}
        {items.length > 0 ? ` ${items.length}` : ""}
      </div>
      {items.length === 0 ? (
        <div className="text-sm text-neutral-500 dark:text-neutral-400">{empty}</div>
      ) : (
        <ul className="space-y-1">
          {items.map((d) => (
            <li key={d.itemId} className="text-sm text-neutral-800 dark:text-neutral-100">
              <span className="break-words">
                {d.wbsCode} {d.name}
              </span>
              <span className="ml-2 whitespace-nowrap text-xs text-neutral-500 dark:text-neutral-400">
                {d.link ?? "未設 Link"}
                {d.start && d.end ? `・${d.start} → ${d.end}` : ""}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
