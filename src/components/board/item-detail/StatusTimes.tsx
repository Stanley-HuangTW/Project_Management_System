"use client";

import { useEffect, useState } from "react";
import { getItemStatusTimes, type ItemStatusTimes } from "@/lib/actions/itemStatusTimes";
import { formatEventTime, type StatusSwitch } from "@/lib/itemEvents";

const sw = (s: StatusSwitch) => `${formatEventTime(s.at)}${s.by ? `・${s.by}` : ""}`;

/**
 * 項目卡片 Status 那一列下面:什麼時候切成進行中、什麼時候切成完成(台灣時間,誰切的)。
 * 狀態一改(statusValue 變了)就重新讀。完成要現在還是完成狀態才算;切回別的狀態會註明「曾於某時完成」。
 */
export function StatusTimes({ itemId, statusValue }: { itemId: string; statusValue: unknown }) {
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
    </div>
  );
}
