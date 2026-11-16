"use client";

import type { DateReason } from "@/lib/scheduleExplain";

/**
 * 開始日 / 完成日那一列下面的一行說明:這個日期是被什麼決定的(前置 + Lag、Start(set) + 天數、
 * 日期約束、子項目統計)。沒有說明(手填的日期)就不畫。日期約束推動的用琥珀色,一眼看得出
 * 「不是照前置排的」。
 */
export function ScheduleReasonLine({
  reason,
  field,
  className = "border-b border-neutral-100 px-4 pb-2 dark:border-neutral-700",
}: {
  reason: DateReason | null | undefined;
  field: "start" | "finish";
  className?: string;
}) {
  if (!reason) return null;
  return (
    <div className={className} data-date-reason={field} data-date-reason-source={reason.source}>
      <p
        className={`text-right text-xs ${
          reason.source === "constraint" ? "text-amber-700 dark:text-amber-300" : "text-neutral-500 dark:text-neutral-400"
        }`}
      >
        <span className="mr-1 rounded bg-neutral-100 px-1 text-[10px] font-medium text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">
          來源
        </span>
        {reason.text}
      </p>
    </div>
  );
}
