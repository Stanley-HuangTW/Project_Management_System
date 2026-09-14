"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Check, X, Clock, CalendarDays } from "lucide-react";
import { useDialogs } from "@/components/ui/DialogProvider";
import {
  listApprovalQueue,
  decideTimeEntry,
  decideLeave,
  type ApprovalQueue as Queue,
} from "@/lib/actions/approval";

/**
 * 待我審核 — the timesheets and leave waiting on this person.
 *
 * Both are 送審制: until they are approved the hours are outside the cost
 * report entirely and the leave does not touch anybody's capacity. So an empty
 * queue is not a quiet day — it is the thing that keeps the numbers honest.
 */
export function ApprovalQueue() {
  const { notify } = useDialogs();
  const [queue, setQueue] = useState<Queue | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => setQueue(await listApprovalQueue()), []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const result = await listApprovalQueue();
      if (!cancelled) {
        setQueue(result);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function run(work: () => Promise<{ error?: string }>, failTitle: string) {
    setBusy(true);
    try {
      const result = await work();
      if (result.error) {
        await notify(result.error, { title: failTitle });
        return;
      }
      await reload();
    } catch (err) {
      await notify(err instanceof Error ? err.message : "操作失敗", { title: failTitle });
    } finally {
      setBusy(false);
    }
  }

  function rejectNote(): string | null {
    const note = window.prompt("退回原因(必填)");
    if (note === null || !note.trim()) return null;
    return note;
  }

  if (loading) return <p className="text-sm text-neutral-400 dark:text-neutral-500">載入中...</p>;
  if (!queue) return null;

  if (!queue.isApprover) {
    return (
      <p className="rounded-md border border-dashed border-neutral-200 dark:border-neutral-700 py-12 text-center text-sm text-neutral-400 dark:text-neutral-500">
        沒有人以你為主管,所以沒有東西需要你審核。
      </p>
    );
  }

  const total = queue.timeEntries.length + queue.leaves.length;
  const approveClass =
    "flex items-center gap-1 rounded bg-green-600 px-2 py-0.5 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-40";
  const rejectClass =
    "flex items-center gap-1 rounded border border-neutral-200 dark:border-neutral-700 px-2 py-0.5 text-xs text-neutral-600 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-800 disabled:opacity-40";

  return (
    <div className="space-y-5">
      {total === 0 && (
        <p className="rounded-md border border-dashed border-neutral-200 dark:border-neutral-700 py-12 text-center text-sm text-neutral-400 dark:text-neutral-500">
          目前沒有待審的項目。
        </p>
      )}

      {queue.timeEntries.length > 0 && (
        <section>
          <h2 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-neutral-800 dark:text-neutral-100">
            <Clock size={14} /> 工時 ({queue.timeEntries.length})
          </h2>
          <p className="mb-2 text-xs text-neutral-500 dark:text-neutral-400">
            核准之後這些工時才會計入成本報表的實際成本(AC)。
          </p>
          <ul className="divide-y divide-neutral-100 dark:divide-neutral-800 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900">
            {queue.timeEntries.map((entry) => (
              <li key={entry.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-xs">
                <span className="w-20 shrink-0 truncate font-medium text-neutral-800 dark:text-neutral-100">
                  {entry.userName}
                </span>
                <span className="w-20 shrink-0 tabular-nums text-neutral-600 dark:text-neutral-300">
                  {entry.date}
                </span>
                <span className="w-12 shrink-0 text-right tabular-nums font-medium text-neutral-800 dark:text-neutral-100">
                  {entry.hours}h
                </span>
                <Link
                  href={`/boards/${entry.boardId}?highlight=${entry.itemId}`}
                  className="min-w-0 flex-1 truncate text-neutral-700 dark:text-neutral-200 hover:text-blue-600"
                >
                  {entry.itemName}
                </Link>
                <span className="shrink-0 text-neutral-400 dark:text-neutral-500">{entry.boardName}</span>
                {entry.note && (
                  <span className="min-w-0 basis-full truncate text-neutral-500 dark:text-neutral-400 sm:basis-auto">
                    {entry.note}
                  </span>
                )}
                <div className="ml-auto flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => run(() => decideTimeEntry(entry.id, "APPROVED", ""), "無法核准")}
                    className={approveClass}
                  >
                    <Check size={12} /> 核准
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      const note = rejectNote();
                      if (note) run(() => decideTimeEntry(entry.id, "REJECTED", note), "無法退回");
                    }}
                    className={rejectClass}
                  >
                    <X size={12} /> 退回
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {queue.leaves.length > 0 && (
        <section>
          <h2 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-neutral-800 dark:text-neutral-100">
            <CalendarDays size={14} /> 請假 ({queue.leaves.length})
          </h2>
          <p className="mb-2 text-xs text-neutral-500 dark:text-neutral-400">
            核准之後那幾天的產能才會歸零,「過度配置」也才會把排在假期上的工作點出來。
          </p>
          <ul className="divide-y divide-neutral-100 dark:divide-neutral-800 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900">
            {queue.leaves.map((leave) => (
              <li key={leave.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-xs">
                <span className="w-20 shrink-0 truncate font-medium text-neutral-800 dark:text-neutral-100">
                  {leave.userName}
                </span>
                <span className="shrink-0 tabular-nums text-neutral-600 dark:text-neutral-300">
                  {leave.startDate} ~ {leave.endDate}
                </span>
                <span className="shrink-0 text-neutral-400 dark:text-neutral-500">{leave.days} 天</span>
                <span className="min-w-0 flex-1 truncate text-neutral-500 dark:text-neutral-400">
                  {leave.reason}
                </span>
                <div className="ml-auto flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => run(() => decideLeave(leave.id, "APPROVED", ""), "無法核准")}
                    className={approveClass}
                  >
                    <Check size={12} /> 核准
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      const note = rejectNote();
                      if (note) run(() => decideLeave(leave.id, "REJECTED", note), "無法退回");
                    }}
                    className={rejectClass}
                  >
                    <X size={12} /> 退回
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
