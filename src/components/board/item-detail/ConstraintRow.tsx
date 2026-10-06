"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ItemConstraintType } from "@prisma/client";
import { setItemConstraint } from "@/lib/actions/constraint";
import { CONSTRAINT_LABELS, applyConstraint } from "@/lib/constraints";
import { useDialogs } from "@/components/ui/DialogProvider";

const NONE = "__none__";

const HINTS: Record<ItemConstraintType, string> = {
  START_NO_EARLIER_THAN: "前置算出的開始日若早於這天,會被推到這天",
  FINISH_NO_LATER_THAN: "期限。不會改動排程,只在超過時提出警告",
  MUST_FINISH_ON: "完成日固定在這天,開始日往回推算",
};

/**
 * The item card's 日期約束 row. Two fields because a constraint is a type and
 * a date together — neither means anything alone.
 */
export function ConstraintRow({
  itemId,
  type,
  date,
  canEdit,
  currentEnd,
  durationDays,
  className = "border-b border-neutral-100 dark:border-neutral-700 px-4 py-2.5",
}: {
  itemId: string;
  type: ItemConstraintType | null;
  date: string | null;
  canEdit: boolean;
  /** The item's current finish, for showing whether a deadline is being met. */
  currentEnd: string | null;
  durationDays: number | null;
  /** 外框的樣式——項目卡片裡是帶底線的一列,別處(人員分配視窗)要自己排版時覆蓋。 */
  className?: string;
}) {
  const router = useRouter();
  const { notify } = useDialogs();
  const [saving, setSaving] = useState(false);
  // A constraint is a type AND a date; picking the type first is the natural
  // order, so hold it here and reveal the date field rather than rejecting a
  // half-filled constraint the user is still in the middle of entering.
  const [draftType, setDraftType] = useState<ItemConstraintType | null>(type);
  const [prevType, setPrevType] = useState(type);
  if (type !== prevType) {
    setPrevType(type);
    setDraftType(type);
  }

  async function save(nextType: ItemConstraintType | null, nextDate: string | null) {
    setSaving(true);
    try {
      const result = await setItemConstraint(itemId, nextType, nextDate);
      if (result.error) {
        await notify(result.error, { title: "無法設定日期約束" });
        return;
      }
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  // Only a deadline can be missed; the other two move the item instead.
  const violation =
    type && date && currentEnd
      ? applyConstraint(
          { start: new Date(currentEnd), end: new Date(currentEnd) },
          durationDays,
          { type, date },
          "CALENDAR",
          new Set()
        ).violation
      : null;

  return (
    <div className={className}>
      <div className="flex items-center justify-between gap-3">
        <span className="shrink-0 text-xs text-neutral-400 dark:text-neutral-500">日期約束</span>
        <div className="flex min-w-0 flex-1 items-center justify-end gap-2">
          <select
            value={draftType ?? NONE}
            disabled={!canEdit || saving}
            onChange={(e) => {
              const next = e.target.value === NONE ? null : (e.target.value as ItemConstraintType);
              setDraftType(next);
              // Clearing takes effect at once; a new type waits for its date.
              if (!next) save(null, null);
              else if (date) save(next, date);
            }}
            className="rounded border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-1.5 py-0.5 text-sm outline-none focus:border-blue-500 disabled:opacity-50"
          >
            <option value={NONE}>無</option>
            {(Object.keys(CONSTRAINT_LABELS) as ItemConstraintType[]).map((key) => (
              <option key={key} value={key}>
                {CONSTRAINT_LABELS[key]}
              </option>
            ))}
          </select>
          {draftType && (
            <input
              type="date"
              value={date ?? ""}
              disabled={!canEdit || saving}
              onChange={(e) =>
                e.target.value ? save(draftType, e.target.value) : save(null, null)
              }
              className="rounded border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-1.5 py-0.5 text-sm outline-none focus:border-blue-500 disabled:opacity-50"
            />
          )}
        </div>
      </div>
      {draftType && (
        <p
          className={`mt-1 text-right text-xs ${
            violation ? "text-red-600" : "text-neutral-400 dark:text-neutral-500"
          }`}
        >
          {violation ?? (date ? HINTS[draftType] : "請選擇約束日期")}
        </p>
      )}
    </div>
  );
}
