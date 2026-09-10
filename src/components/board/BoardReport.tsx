"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { BoardWithData, ItemData, UserOption } from "@/types/board";
import type { Holiday, UserRole } from "@prisma/client";
import { computeOverdueUpcoming } from "@/lib/dashboard";
import { toHolidaySet } from "@/lib/holidays";
import {
  filterItemsByTeam,
  computeStatusBuckets,
  groupItemsByBucket,
  bucketSlices,
  computeTasksByOwnerBuckets,
} from "@/lib/boardReport";
import { pieSlicePath } from "@/lib/pie";
import { computeProgressCurve, type CurveTask } from "@/lib/progressCurve";
import { getItemDateRange } from "@/lib/gantt";
import { ProgressCurveChart } from "./ProgressCurveChart";
import { CostReport } from "./CostReport";
import { computeWbsCodes } from "@/lib/wbs";

/** WBS code for every item on the board, computed per group (codes are
 *  group-scoped, same rule as the table's own WBS badges). */
function computeBoardWbsCodes(items: ItemData[]): Map<string, string> {
  const itemsByGroup = new Map<string, ItemData[]>();
  for (const item of items) {
    const list = itemsByGroup.get(item.groupId) ?? [];
    list.push(item);
    itemsByGroup.set(item.groupId, list);
  }
  const result = new Map<string, string>();
  for (const groupItems of itemsByGroup.values()) {
    for (const [id, code] of computeWbsCodes(groupItems)) result.set(id, code);
  }
  return result;
}

function StatCard({
  label,
  value,
  color,
  onClick,
}: {
  label: string;
  value: number;
  color?: string;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className="rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 p-4 text-center enabled:hover:border-neutral-300 dark:enabled:hover:border-neutral-600 enabled:hover:bg-neutral-50 dark:enabled:hover:bg-neutral-800 disabled:cursor-default"
    >
      <p className="text-xs text-neutral-500 dark:text-neutral-400">{label}</p>
      <p
        className={`mt-1 text-2xl font-semibold ${color ? "" : "text-neutral-800 dark:text-neutral-100"}`}
        style={color ? { color } : undefined}
      >
        {value}
      </p>
    </button>
  );
}

function ItemListModal({
  title,
  items,
  wbsByItemId,
  boardId,
  onClose,
}: {
  title: string;
  items: ItemData[];
  wbsByItemId: Map<string, string>;
  boardId: string;
  onClose: () => void;
}) {
  const router = useRouter();
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div
        className="max-h-[80vh] w-full max-w-md overflow-hidden rounded-lg bg-white dark:bg-neutral-900 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-neutral-200 dark:border-neutral-700 px-4 py-3">
          <h3 className="text-sm font-semibold text-neutral-800 dark:text-neutral-100">
            {title}({items.length})
          </h3>
          <button type="button" onClick={onClose} className="text-neutral-400 dark:text-neutral-500 hover:text-neutral-600 dark:hover:text-neutral-400">
            ✕
          </button>
        </div>
        <ul className="max-h-[65vh] divide-y divide-neutral-100 dark:divide-neutral-700 overflow-y-auto">
          {items.length === 0 ? (
            <li className="px-4 py-6 text-center text-sm text-neutral-400 dark:text-neutral-500">沒有項目</li>
          ) : (
            items.map((item) => (
              <li key={item.id}>
                <Link
                  href={`/boards/${boardId}?highlight=${item.id}`}
                  onClick={() => {
                    router.refresh();
                    onClose();
                  }}
                  className="block truncate px-4 py-2 text-sm text-neutral-700 dark:text-neutral-100 hover:bg-neutral-50 dark:hover:bg-neutral-800 hover:text-blue-600"
                >
                  {wbsByItemId.get(item.id) && (
                    <span className="mr-1 text-neutral-400 dark:text-neutral-500">
                      {wbsByItemId.get(item.id)}
                    </span>
                  )}
                  {item.name}
                </Link>
              </li>
            ))
          )}
        </ul>
      </div>
    </div>
  );
}

/**
 * The tasks the S-curve counts: leaves only.
 *
 * A Summary's dates are its children's dates, so counting it as well would
 * count the same work twice and make the curve jump whenever someone adds a
 * grouping row.
 */
function buildCurveTasks(board: BoardWithData, items: ItemData[], holidays: Set<string>): CurveTask[] {
  const parentIds = new Set(board.items.map((i) => i.parentId).filter(Boolean));
  const doneIds = new Set(board.reportDoneOptionIds);
  return items
    .filter((item) => !parentIds.has(item.id))
    .map((item) => {
      const range =
        board.ganttStartColumnId && board.ganttDurationColumnId
          ? getItemDateRange(
              item,
              board.ganttStartColumnId,
              board.ganttDurationColumnId,
              board.ganttDurationMode,
              holidays
            )
          : null;
      const status = board.reportStatusColumnId
        ? item.cellValues.find((cv) => cv.columnId === board.reportStatusColumnId)?.value
        : undefined;
      return {
        baselineEnd: item.baselineEnd,
        scheduledEnd: range ? range.end.toISOString().slice(0, 10) : null,
        isDone: typeof status === "string" && doneIds.has(status),
      };
    });
}

export function BoardReport({
  board,
  users,
  userRole,
  currentUserId,
  holidays,
}: {
  board: BoardWithData;
  users: UserOption[];
  userRole: UserRole;
  currentUserId: string;
  holidays: Holiday[];
}) {
  const router = useRouter();
  const isSupervisor = userRole === "SUPERVISOR";
  const teamIds = isSupervisor
    ? [currentUserId, ...users.filter((u) => u.supervisorId === currentUserId).map((u) => u.id)]
    : null;
  const [scope, setScope] = useState<"team" | "all">(isSupervisor ? "team" : "all");
  const effectiveTeamIds = scope === "team" ? teamIds : null;
  const [listModal, setListModal] = useState<{ title: string; items: ItemData[] } | null>(null);

  const holidaySet = toHolidaySet(holidays);
  const items = filterItemsByTeam(board, effectiveTeamIds);
  const wbsByItemId = computeBoardWbsCodes(board.items);
  const buckets = computeStatusBuckets(board, items, holidaySet);
  const itemsByBucket = groupItemsByBucket(board, items, holidaySet);
  const statusBreakdown = bucketSlices(buckets, itemsByBucket);
  const owners = computeTasksByOwnerBuckets(board, items, users, holidaySet);
  const { overdue } = computeOverdueUpcoming([board], effectiveTeamIds ?? undefined);

  const statusTotal = buckets.total;
  const curve = computeProgressCurve(buildCurveTasks(board, items, holidaySet), new Date().toISOString().slice(0, 10));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        {isSupervisor ? (
          <div className="flex overflow-hidden rounded-md border border-neutral-200 dark:border-neutral-700 text-xs">
            <button
              type="button"
              onClick={() => setScope("team")}
              className={`px-2.5 py-1 ${scope === "team" ? "bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900" : "bg-white dark:bg-neutral-900 text-neutral-600 dark:text-neutral-400 hover:bg-neutral-50 dark:hover:bg-neutral-800"}`}
            >
              我的團隊
            </button>
            <button
              type="button"
              onClick={() => setScope("all")}
              className={`px-2.5 py-1 ${scope === "all" ? "bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900" : "bg-white dark:bg-neutral-900 text-neutral-600 dark:text-neutral-400 hover:bg-neutral-50 dark:hover:bg-neutral-800"}`}
            >
              全部
            </button>
          </div>
        ) : (
          <div />
        )}
      </div>

      {!board.reportStatusColumnId && (
        <p className="text-sm text-neutral-400 dark:text-neutral-500">
          尚未設定要統計的狀態欄位,請至「系統設定」的報表設定選擇。
        </p>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
        <StatCard label="全部任務" value={buckets.total} onClick={() => setListModal({ title: "全部任務", items })} />
        <StatCard
          label="尚未處理"
          value={buckets.notStarted}
          color="#c4c4c4"
          onClick={() => setListModal({ title: "尚未處理", items: itemsByBucket.notStarted })}
        />
        <StatCard
          label="計畫中"
          value={buckets.planned}
          color="#579bfc"
          onClick={() => setListModal({ title: "計畫中", items: itemsByBucket.planned })}
        />
        <StatCard
          label="進行中"
          value={buckets.inProgress}
          color="#fdab3d"
          onClick={() => setListModal({ title: "進行中", items: itemsByBucket.inProgress })}
        />
        <StatCard
          label="暫停"
          value={buckets.paused}
          color="#a25ddc"
          onClick={() => setListModal({ title: "暫停", items: itemsByBucket.paused })}
        />
        <StatCard
          label="卡住"
          value={buckets.stuck}
          color="#e2445c"
          onClick={() => setListModal({ title: "卡住", items: itemsByBucket.stuck })}
        />
        <StatCard
          label="逾期"
          value={buckets.overdue}
          color="#d83a17"
          onClick={() => setListModal({ title: "逾期", items: itemsByBucket.overdue })}
        />
        <StatCard
          label="已完成"
          value={buckets.done}
          color="#00c875"
          onClick={() => setListModal({ title: "已完成", items: itemsByBucket.done })}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <section className="rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 p-4">
          <h3 className="mb-3 text-sm font-semibold text-neutral-700 dark:text-neutral-100">依狀態分布</h3>
          {statusBreakdown.length === 0 ? (
            <p className="text-sm text-neutral-400 dark:text-neutral-500">尚無資料</p>
          ) : (
            <div className="flex flex-wrap items-center gap-4">
              <svg viewBox="0 0 120 120" width={120} height={120} className="shrink-0">
                {(() => {
                  let cumulative = 0;
                  return statusBreakdown.map((s) => {
                    const fraction = statusTotal > 0 ? s.count / statusTotal : 0;
                    const startAngle = cumulative * 2 * Math.PI;
                    cumulative += fraction;
                    const endAngle = cumulative * 2 * Math.PI;
                    if (fraction >= 0.999) {
                      return <circle key={s.key} cx={60} cy={60} r={55} fill={s.color} />;
                    }
                    return <path key={s.key} d={pieSlicePath(60, 60, 55, startAngle, endAngle)} fill={s.color} />;
                  });
                })()}
              </svg>
              <div className="min-w-[140px] flex-1 space-y-1">
                {statusBreakdown.map((s) => (
                  <button
                    key={s.key}
                    type="button"
                    onClick={() => setListModal({ title: s.label, items: s.items })}
                    className="flex w-full items-center gap-2 rounded text-sm hover:bg-neutral-50 dark:hover:bg-neutral-800"
                  >
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: s.color }} />
                    <span className="min-w-0 flex-1 truncate text-left text-neutral-700 dark:text-neutral-100">{s.label}</span>
                    <span className="shrink-0 text-neutral-500 dark:text-neutral-400">{s.count}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </section>

        <section className="rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 p-4">
          <h3 className="mb-3 text-sm font-semibold text-neutral-700 dark:text-neutral-100">依負責人分布</h3>
          {owners.length === 0 ? (
            <p className="text-sm text-neutral-400 dark:text-neutral-500">尚無資料</p>
          ) : (
            <div className="space-y-3">
              {owners.map((o) => (
                <div key={o.userId}>
                  <div className="flex items-center gap-3">
                    <span className="w-16 shrink-0 truncate text-sm text-neutral-700 dark:text-neutral-100">{o.userName}</span>
                    <div className="flex h-3 flex-1 overflow-hidden rounded-full bg-neutral-100 dark:bg-neutral-800">
                      {o.slices.map((s) => (
                        <div
                          key={s.key}
                          title={`${s.label} ${s.count}`}
                          style={{ width: `${(s.count / o.total) * 100}%`, backgroundColor: s.color }}
                        />
                      ))}
                    </div>
                    <span className="w-6 shrink-0 text-right text-sm text-neutral-500 dark:text-neutral-400">{o.total}</span>
                  </div>
                  <div className="ml-[76px] mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
                    {o.slices.map((s) => (
                      <button
                        key={s.key}
                        type="button"
                        onClick={() => setListModal({ title: `${o.userName} - ${s.label}`, items: s.items })}
                        className="flex items-center gap-1 text-xs text-neutral-500 dark:text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-100"
                      >
                        <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: s.color }} />
                        {s.label} {s.count}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      <section className="rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 p-4">
        <h3 className="mb-3 text-sm font-semibold text-neutral-700 dark:text-neutral-100">成本與 EVM</h3>
        <CostReport boardId={board.id} />
      </section>

      <section className="rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 p-4">
        <h3 className="mb-3 text-sm font-semibold text-neutral-700 dark:text-neutral-100">進度曲線</h3>
        <ProgressCurveChart curve={curve} />
      </section>

      <section className="rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 p-4">
        <h3 className="mb-3 text-sm font-semibold text-neutral-700 dark:text-neutral-100">逾期任務({overdue.length})</h3>
        {overdue.length === 0 ? (
          <p className="text-sm text-neutral-400 dark:text-neutral-500">沒有逾期項目</p>
        ) : (
          <ul className="space-y-1.5">
            {overdue.map((e) => (
              <li key={e.itemId} className="flex items-center justify-between text-sm">
                <Link
                  href={`/boards/${e.boardId}?highlight=${e.itemId}`}
                  onClick={() => router.refresh()}
                  className="truncate text-neutral-700 dark:text-neutral-100 hover:text-blue-600"
                >
                  {e.itemName}
                </Link>
                <span className="shrink-0 text-xs text-red-600">
                  {e.end.getUTCMonth() + 1}/{e.end.getUTCDate()}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {listModal && (
        <ItemListModal
          title={listModal.title}
          items={listModal.items}
          wbsByItemId={wbsByItemId}
          boardId={board.id}
          onClose={() => setListModal(null)}
        />
      )}
    </div>
  );
}
