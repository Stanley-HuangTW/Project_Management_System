"use client";

import { useMemo, useState } from "react";
import { AlertTriangle } from "lucide-react";
import type { UserRole } from "@prisma/client";
import type { MemberTask } from "@/lib/workload";
import type { UserOption } from "@/types/board";
import { findOverAllocations, movableTasks } from "@/lib/overAllocation";
import { loadItemDetailContext, type ItemDetailContext } from "@/lib/actions/itemSchedule";
import { ItemDetailModal } from "@/components/board/ItemDetailModal";
import { useDialogs } from "@/components/ui/DialogProvider";

const DAY_MS = 86_400_000;
/** 工作 loading 門檻的預設值 — 超過這個百分比才算過度配置。 */
const DEFAULT_THRESHOLD_PCT = 95;
/** A custom range longer than this is almost certainly a typo in the date
 *  box, and scanning it costs a day-by-day pass per person. */
const MAX_CUSTOM_DAYS = 366;

type Unit = "week" | "month" | "custom";

function toIso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function mondayOf(date: Date): Date {
  const day = date.getUTCDay();
  const offset = day === 0 ? -6 : 1 - day;
  return new Date(date.getTime() + offset * DAY_MS);
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

/**
 * 過度配置 — who is booked past the threshold in a window, and what is doing it.
 *
 * The workload timeline already shows the colour; this answers the question
 * that follows it, which is the one somebody has to act on: which tasks are
 * stacked on this person, and which of them could move without moving the
 * project.
 *
 * The window and the threshold are both controls rather than fixed values: a
 * team lead planning next quarter and one firefighting this week are asking
 * different questions of the same data, and 95% vs 120% is the difference
 * between "everyone is listed" and "only the real fires are".
 */
export function OverAllocationCard({
  users,
  tasksByUser,
  floatByItemId,
  leaveDays,
  thresholdPct = DEFAULT_THRESHOLD_PCT,
  allUsers,
  currentUserId,
  userRole,
}: {
  users: { id: string; name: string }[];
  tasksByUser: Record<string, MemberTask[]>;
  /** itemId -> total float in working days, where the board's critical path
   *  could be computed. */
  floatByItemId: Record<string, number>;
  /** userId -> the days they are away. Capacity is zero on those days, so
   *  anything booked at all counts as over. */
  leaveDays: Record<string, string[]>;
  /** Starting value for the threshold control. */
  thresholdPct?: number;
  /** For the item-card modal a task name opens — not the overload candidates
   *  above, which is a narrower, different list. */
  allUsers: UserOption[];
  currentUserId: string;
  userRole: UserRole;
}) {
  const [unit, setUnit] = useState<Unit>("week");
  const [offset, setOffset] = useState(0);
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  // What the boxes hold vs what is being shown: typing "9" into a percentage
  // box should not redraw the list as if the threshold were 9%.
  const [thresholdInput, setThresholdInput] = useState(String(thresholdPct));
  const [threshold, setThreshold] = useState(thresholdPct);
  const [appliedCustom, setAppliedCustom] = useState<{ from: string; to: string } | null>(null);
  const { notify } = useDialogs();
  const [itemDetail, setItemDetail] = useState<ItemDetailContext | null>(null);
  const [openingItemId, setOpeningItemId] = useState<string | null>(null);

  async function openItemDetail(itemId: string) {
    setOpeningItemId(itemId);
    try {
      const context = await loadItemDetailContext(itemId);
      if (!context) {
        await notify("找不到這個項目,或者沒有存取權限");
        return;
      }
      setItemDetail(context);
    } catch (err) {
      await notify(err instanceof Error ? err.message : "載入失敗");
    } finally {
      setOpeningItemId(null);
    }
  }

  const window = useMemo(() => {
    const today = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);
    if (unit === "custom") {
      if (!appliedCustom) return null;
      const from = new Date(`${appliedCustom.from}T00:00:00.000Z`);
      const to = new Date(`${appliedCustom.to}T00:00:00.000Z`);
      const days = Math.floor((to.getTime() - from.getTime()) / DAY_MS) + 1;
      if (days < 1) return null;
      return { start: from, days: Math.min(days, MAX_CUSTOM_DAYS) };
    }
    if (unit === "month") {
      const base = new Date(
        Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + offset, 1)
      );
      return { start: base, days: daysInMonth(base.getUTCFullYear(), base.getUTCMonth()) };
    }
    return { start: new Date(mondayOf(today).getTime() + offset * 7 * DAY_MS), days: 7 };
  }, [unit, offset, appliedCustom]);

  const overloads = useMemo(() => {
    if (!window) return [];
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
      window.start,
      window.days,
      threshold,
      new Map(Object.entries(floatByItemId)),
      new Map(Object.entries(leaveDays).map(([id, days]) => [id, new Set(days)]))
    );
  }, [tasksByUser, users, window, threshold, floatByItemId, leaveDays]);

  const rangeLabel = window
    ? `${toIso(window.start).slice(5)} ~ ${toIso(
        new Date(window.start.getTime() + (window.days - 1) * DAY_MS)
      ).slice(5)}`
    : "";

  function applyThreshold() {
    const value = Number(thresholdInput);
    if (!Number.isFinite(value) || value < 1 || value > 500) {
      setThresholdInput(String(threshold));
      return;
    }
    setThreshold(Math.round(value));
  }

  function applyCustom() {
    if (!customFrom || !customTo || customFrom > customTo) return;
    setAppliedCustom({ from: customFrom, to: customTo });
  }

  const unitButton = (value: Unit, label: string) => (
    <button
      key={value}
      type="button"
      onClick={() => {
        setUnit(value);
        setOffset(0);
      }}
      className={`rounded border px-2 py-0.5 text-xs ${
        unit === value
          ? "border-neutral-800 bg-neutral-800 text-white dark:border-neutral-200 dark:bg-neutral-200 dark:text-neutral-900"
          : "border-neutral-200 dark:border-neutral-700 text-neutral-600 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-800"
      }`}
    >
      {label}
    </button>
  );

  const stepButtonClass =
    "rounded border border-neutral-200 dark:border-neutral-700 px-2 py-0.5 text-xs text-neutral-600 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-800 disabled:opacity-40";
  const fieldClass =
    "rounded-md border border-neutral-300 dark:border-neutral-600 dark:bg-neutral-900 px-1.5 py-0.5 text-xs outline-none focus:border-blue-500";

  return (
    <section className="rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold text-neutral-800 dark:text-neutral-100">過度配置</h2>
        <span className="text-xs text-neutral-400 dark:text-neutral-500">{rangeLabel}</span>

        <label className="ml-2 flex items-center gap-1 text-xs text-neutral-500 dark:text-neutral-400">
          超過
          <input
            type="number"
            min={1}
            max={500}
            value={thresholdInput}
            onChange={(e) => setThresholdInput(e.target.value)}
            onBlur={applyThreshold}
            onKeyDown={(e) => {
              if (e.key === "Enter") applyThreshold();
            }}
            className={`${fieldClass} w-16 tabular-nums`}
            title="工作 loading 門檻:一天的配置總和超過這個百分比就列出來"
          />
          %
        </label>

        <div className="ml-auto flex flex-wrap items-center gap-1">
          {unitButton("week", "週")}
          {unitButton("month", "月")}
          {unitButton("custom", "自訂")}

          {unit === "custom" ? (
            <>
              <input
                type="date"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
                className={fieldClass}
              />
              <span className="text-xs text-neutral-400 dark:text-neutral-500">~</span>
              <input
                type="date"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
                className={fieldClass}
              />
              <button
                type="button"
                onClick={applyCustom}
                disabled={!customFrom || !customTo || customFrom > customTo}
                className="rounded bg-blue-600 px-2 py-0.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-40"
              >
                查詢
              </button>
            </>
          ) : (
            <>
              <button type="button" onClick={() => setOffset((o) => o - 1)} className={stepButtonClass}>
                {unit === "month" ? "上個月" : "上週"}
              </button>
              <button
                type="button"
                onClick={() => setOffset(0)}
                disabled={offset === 0}
                className={stepButtonClass}
              >
                {unit === "month" ? "本月" : "本週"}
              </button>
              <button type="button" onClick={() => setOffset((o) => o + 1)} className={stepButtonClass}>
                {unit === "month" ? "下個月" : "下週"}
              </button>
            </>
          )}
        </div>
      </div>

      {!window ? (
        <p className="text-sm text-neutral-400 dark:text-neutral-500">
          請選擇日期區間並按「查詢」。
        </p>
      ) : overloads.length === 0 ? (
        <p className="text-sm text-neutral-400 dark:text-neutral-500">
          這個區間沒有人超過 {threshold}%。
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
                    {/* A month can be overloaded end to end; listing sixty
                        dates buries the names the row exists to show. */}
                    {overload.days
                      .slice(0, 10)
                      .map((d) => `${d.date.slice(5)}${d.onLeave ? "(休假)" : ""}`)
                      .join("、")}
                    {overload.days.length > 10 && `…等 ${overload.days.length} 天`})
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
                      <button
                        type="button"
                        disabled={openingItemId === task.itemId}
                        onClick={() => openItemDetail(task.itemId)}
                        title={task.itemName}
                        className="min-w-0 flex-1 truncate text-left text-neutral-700 dark:text-neutral-100 hover:text-blue-600 hover:underline disabled:opacity-60"
                      >
                        {task.wbsCode && (
                          <span className="mr-1 tabular-nums text-neutral-400 dark:text-neutral-500">
                            {task.wbsCode}
                          </span>
                        )}
                        {task.itemName}
                      </button>
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

      <ItemDetailModal
        boardId={itemDetail?.boardId ?? ""}
        item={itemDetail?.item ?? null}
        columns={itemDetail?.columns ?? []}
        users={allUsers}
        progressColumnId={itemDetail?.progressColumnId ?? null}
        ganttStartColumnId={itemDetail?.ganttStartColumnId}
        ganttDurationColumnId={itemDetail?.ganttDurationColumnId}
        ganttEndColumnId={itemDetail?.ganttEndColumnId}
        predColumnId={itemDetail?.predColumnId}
        linkColumnId={itemDetail?.linkColumnId}
        groupItems={itemDetail?.groupItems}
        userRole={userRole}
        currentUserId={currentUserId}
        open={itemDetail !== null}
        onOpenChange={(open) => !open && setItemDetail(null)}
        initialTab="card"
      />
    </section>
  );
}
