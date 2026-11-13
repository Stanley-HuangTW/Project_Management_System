"use client";

import { useEffect, useState } from "react";
import { getItemStatusTimes, type ItemStatusTimes } from "@/lib/actions/itemStatusTimes";
import { formatEventTime, type StatusSwitch } from "@/lib/itemEvents";
import { lateFinishOf } from "@/lib/lateFinish";
import { shortWithWeekday } from "@/lib/weekdayLabel";

const sw = (s: StatusSwitch) => `${formatEventTime(s.at)}${s.by ? `・${s.by}` : ""}`;

/**
 * 項目卡片 Status 那一列下面:什麼時候切成進行中、什麼時候切成完成(台灣時間,誰切的)。
 * 狀態一改(statusValue 變了)就重新讀。完成要現在還是完成狀態才算;切回別的狀態會註明「曾於某時完成」。
 */
export function StatusTimes({
  itemId,
  statusValue,
  late,
}: {
  itemId: string;
  statusValue: unknown;
  /** 預定完成日(Finish)與「依實際完成日順延」:給了才會在實際完成晚於預定時多顯示一行提醒。 */
  late?: { plannedEnd: string | null; dependentCount: number; onShift?: (actualDate: string) => void | Promise<void> };
}) {
  const [times, setTimes] = useState<ItemStatusTimes | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const result = await getItemStatusTimes(itemId);
      if (!cancelled) setTimes(result);
    })();
    return () => {
      cancelled = true;
    };
  }, [itemId, statusValue]);

  if (!times) return null;
  const lateInfo = late ? lateFinishOf(late.plannedEnd, times.completed?.at) : null;
  const empty = "text-neutral-300 dark:text-neutral-600";
  return (
    <div
      data-status-times
      className="flex flex-wrap gap-x-6 gap-y-1 border-b border-neutral-100 px-4 py-1.5 text-[11px] text-neutral-500 dark:border-neutral-700 dark:text-neutral-400"
    >
      <span>
        切成進行中:
        {times.started ? <span className="font-medium text-neutral-700 dark:text-neutral-200">{sw(times.started)}</span> : <span className={empty}>尚未</span>}
      </span>
      <span>
        切成完成:
        {times.completed ? (
          <span className="font-medium text-neutral-700 dark:text-neutral-200">{sw(times.completed)}</span>
        ) : times.wasCompleted ? (
          <span>
            <span className={empty}>目前不是完成</span>(曾於 {sw(times.wasCompleted)} 完成)
          </span>
        ) : (
          <span className={empty}>尚未</span>
        )}
      </span>
      {lateInfo && late && (
        <span data-late-finish className="flex w-full flex-wrap items-center gap-x-2 gap-y-1 text-red-600 dark:text-red-400">
          ⚠ 預定 {shortWithWeekday(lateInfo.plannedEnd.slice(5), lateInfo.plannedEnd)} 完成,實際 {shortWithWeekday(lateInfo.actualDate.slice(5), lateInfo.actualDate)} 才完成(晚 {lateInfo.daysLate} 天)
          {late.dependentCount > 0 ? `;有 ${late.dependentCount} 個後續工作項依賴它,可能需要順延` : ""}。原計畫(基準線)不受影響,可隨時比較。
          {late.onShift && (
            <button
              type="button"
              data-late-finish-shift
              onClick={() => void late.onShift?.(lateInfo.actualDate)}
              className="rounded border border-red-300 px-1.5 py-0.5 text-[11px] font-medium text-red-700 hover:bg-red-50 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-950"
            >
              依實際完成日順延後續
            </button>
          )}
        </span>
      )}
    </div>
  );
}
