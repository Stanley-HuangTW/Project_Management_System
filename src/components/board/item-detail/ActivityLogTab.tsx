"use client";

import { useEffect, useState } from "react";
import { Avatar } from "@/components/ui/Avatar";
import { listActivityLog } from "@/lib/actions/activityLog";
import { formatEventDateTime } from "@/lib/itemEvents";

/** dispatcher / dispatchedAt:任務派遣人(建立這個項目的人)與派遣時間,寫在最上面,沒有任何紀錄時也看得到。 */
export function ActivityLogTab({
  itemId,
  dispatcher,
  dispatchedAt,
}: {
  itemId: string;
  dispatcher: string | undefined;
  dispatchedAt: Date;
}) {
  const [entries, setEntries] = useState<Awaited<ReturnType<typeof listActivityLog>>>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const result = await listActivityLog(itemId);
        if (!cancelled) setEntries(result);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [itemId]);

  return (
    <div className="space-y-3">
      <div
        data-dispatch-info
        className="flex items-center gap-3 rounded-md bg-neutral-50 px-3 py-2 text-sm dark:bg-neutral-800/60"
      >
        <span className="shrink-0 text-xs text-neutral-400 dark:text-neutral-500">任務派遣</span>
        <span className="min-w-0 flex-1 truncate text-neutral-700 dark:text-neutral-100">{dispatcher ?? "—"}</span>
        <span className="shrink-0 text-xs text-neutral-400 dark:text-neutral-500">{formatEventDateTime(dispatchedAt)}</span>
      </div>
      {loading && <p className="text-sm text-neutral-400 dark:text-neutral-500">載入中...</p>}
      {!loading && entries.length === 0 && (
        <p className="text-sm text-neutral-400 dark:text-neutral-500">尚無活動紀錄</p>
      )}
      {entries.map((e) => (
        <div key={e.id} className="flex items-center gap-3 text-sm">
          <Avatar name={e.actor?.name ?? "系統"} avatarUrl={e.actor?.avatarUrl} size={24} title={e.actor?.name ?? "系統"} />
          <span className="min-w-0 flex-1 text-neutral-700 dark:text-neutral-100">{e.message}</span>
          <span className="shrink-0 text-xs text-neutral-400 dark:text-neutral-500">
            {new Date(e.createdAt).toLocaleString("zh-TW")}
          </span>
        </div>
      ))}
    </div>
  );
}
