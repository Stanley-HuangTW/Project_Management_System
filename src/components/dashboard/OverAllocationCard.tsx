"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import type { MemberTask } from "@/lib/workload";
import { findOverAllocations, movableTasks } from "@/lib/overAllocation";

const DAY_MS = 86_400_000;

function mondayOf(date: Date): Date {
  const day = date.getUTCDay();
  const offset = day === 0 ? -6 : 1 - day;
  return new Date(date.getTime() + offset * DAY_MS);
}

/**
 * 過度配置 — who is booked past 100% this week, and what is doing it.
 *
 * The workload timeline already shows the colour; this answers the question
 * that follows it, which is the one somebody has to act on: which tasks are
 * stacked on this person, and which of them could move without moving the
 * project.
 */
export function OverAllocationCard({
  users,
  tasksByUser,
  floatByItemId,
  leaveDays,
  thresholdPct = 100,
}: {
  users: { id: string; name: string }[];
  tasksByUser: Record<string, MemberTask[]>;
  /** itemId -> total float in working days, where the board's critical path
   *  could be computed. */
  floatByItemId: Record<string, number>;
  /** userId -> the days they are away. Capacity is zero on those days, so
   *  anything booked at all counts as over. */
  leaveDays: Record<string, string[]>;
  thresholdPct?: number;
}) {
  const [weekOffset, setWeekOffset] = useState(0);

  const weekStart = useMemo(() => {
    const today = new Date(new Date().toISOString().slice(0, 10));
    return new Date(mondayOf(today).getTime() + weekOffset * 7 * DAY_MS);
  }, [weekOffset]);

  const overloads = useMemo(() => {
    const byUser = new Map(
      Object.entries(tasksByUser).map(([id, tasks]) => [
        id,
        tasks.map((t) => ({
          ...t,
          startDate: t.startDate ? new Date(t.startDate) : null,
          endDate: t.endDate ? new Date(t.endDate) : null,
        })),
      ])
    );
    return findOverAllocations(
      byUser,
      users,
      weekStart,
      7,
      thresholdPct,
      new Map(Object.entries(floatByItemId)),
      new Map(Object.entries(leaveDays).map(([id, days]) => [id, new Set(days)]))
    );
  }, [tasksByUser, users, weekStart, thresholdPct, floatByItemId, leaveDays]);

  const weekLabel = `${weekStart.toISOString().slice(5, 10)} ~ ${new Date(weekStart.getTime() + 6 * DAY_MS)
    .toISOString()
    .slice(5, 10)}`;

  return (
    <section className="rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold text-neutral-800 dark:text-neutral-100">過度配置</h2>
        <span className="text-xs text-neutral-400 dark:text-neutral-500">{weekLabel}</span>
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            onClick={() => setWeekOffset((w) => w - 1)}
            className="rounded border border-neutral-200 dark:border-neutral-700 px-2 py-0.5 text-xs text-neutral-600 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-800"
          >
            上週
          </button>
          <button
            type="button"
            onClick={() => setWeekOffset(0)}
            disabled={weekOffset === 0}
            className="rounded border border-neutral-200 dark:border-neutral-700 px-2 py-0.5 text-xs text-neutral-600 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-800 disabled:opacity-40"
          >
            本週
          </button>
          <button
            type="button"
            onClick={() => setWeekOffset((w) => w + 1)}
            className="rounded border border-neutral-200 dark:border-neutral-700 px-2 py-0.5 text-xs text-neutral-600 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-800"
          >
            下週
          </button>
        </div>
      </div>

      {overloads.length === 0 ? (
        <p className="text-sm text-neutral-400 dark:text-neutral-500">
          這週沒有人超過 {thresholdPct}%。
        </p>
      ) : (
        <ul className="space-y-3">
          {overloads.map((overload) => {
            const movable = movableTasks(overload);
            return (
              <li key={overload.userId} className="rounded-md border border-red-200 dark:border-red-900 p-3">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="text-sm font-medium text-neutral-800 dark:text-neutral-100">
                    {overload.userName}
                  </span>
                  <span className="text-sm font-semibold text-red-600">最高 {overload.peakPct}%</span>
                  <span className="text-xs text-neutral-400 dark:text-neutral-500">
                    超載 {overload.days.length} 天(
                    {overload.days.map((d) => `${d.date.slice(5)}${d.onLeave ? "(休假)" : ""}`).join("、")})
                  </span>
                  {overload.leaveDays > 0 && (
                    <span className="rounded bg-amber-100 dark:bg-amber-950 px-1.5 py-0.5 text-[11px] font-medium text-amber-800 dark:text-amber-200">
                      其中 {overload.leaveDays} 天在休假
                    </span>
                  )}
                </div>

                <ul className="mt-2 space-y-1">
                  {overload.tasks.map((task) => (
                    <li key={task.itemId} className="flex flex-wrap items-baseline gap-2 text-xs">
                      <span className="w-12 shrink-0 text-right tabular-nums text-neutral-600 dark:text-neutral-300">
                        {task.allocationPct}%
                      </span>
                      <Link
                        href={`/boards/${task.boardId}?highlight=${task.itemId}`}
                        className="min-w-0 flex-1 truncate text-neutral-700 dark:text-neutral-100 hover:text-blue-600"
                      >
                        {task.itemName}
                      </Link>
                      <span className="shrink-0 text-neutral-400 dark:text-neutral-500">{task.boardName}</span>
                      {task.totalFloat !== null && (
                        <span
                          className={`shrink-0 ${
                            task.totalFloat > 0 ? "text-green-600" : "text-red-600"
                          }`}
                        >
                          {task.totalFloat > 0 ? `浮時 ${task.totalFloat} 天` : "在要徑上"}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>

                <p className="mt-2 flex items-start gap-1.5 text-xs text-neutral-500 dark:text-neutral-400">
                  <AlertTriangle size={13} className="mt-0.5 shrink-0 text-amber-500" />
                  {overload.leaveDays > 0 ? (
                    <span>
                      有工作排在這個人休假的日子上——那幾天的產能是 0,不管排了多少都做不了。
                      先把那幾天的工作挪開,再看剩下的是不是還超載。
                    </span>
                  ) : movable.length > 0 ? (
                    <span>
                      可以考慮把有浮時的{movable.map((t) => `「${t.itemName}」`).join("")}往後挪
                      ——它們延後不會影響專案完成日;其餘的在要徑上,動了就會動到結案時間。
                    </span>
                  ) : (
                    <span>
                      這些工作項都沒有浮時(或尚未計算要徑),挪動任何一個都會影響專案完成日
                      ——要解的話得改配置比例或換人。
                    </span>
                  )}
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
