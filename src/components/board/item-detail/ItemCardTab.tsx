"use client";

import { useEffect, useState } from "react";
import type { UserRole } from "@prisma/client";
import { listTodoItems } from "@/lib/actions/todo";
import { renameItem } from "@/lib/actions/item";
import { canEditCellValue, canManageStructure, canModifyItemSchedule } from "@/lib/permissions";
import { isItemAssignedToUser } from "@/lib/itemAssignment";
import type { ScheduleLock } from "@/lib/predecessorLink";
import { computeWbsCodes } from "@/lib/wbs";
import { listDependentItems } from "@/lib/predecessorLink";
import { DependentItemsRow } from "../DependentItemsRow";
import { PredLampDot } from "../PredLampDot";
import { ConstraintRow } from "./ConstraintRow";
import { resolveBaselineVariance, describeBaselineDelta } from "@/lib/baseline";
import type { PredLamp } from "@/lib/predLamp";
import type { ScheduleFloat } from "@/lib/criticalPath";
import { CellEditor } from "../cell-editors/CellEditor";
import { useDialogs } from "@/components/ui/DialogProvider";
import type { ColumnData, ItemData, UserOption, PredOption } from "@/types/board";

export function ItemCardTab({
  boardId,
  item,
  columns,
  users,
  progressColumnId,
  ganttStartColumnId,
  ganttDurationColumnId,
  ganttEndColumnId,
  predColumnId,
  linkColumnId,
  predLamp,
  scheduleFloat,
  groupItems,
  crossGroupPredOptions,
  lockedScheduleFields,
  manualScheduleHint,
  userRole,
  currentUserId,
}: {
  boardId: string;
  item: ItemData;
  columns: ColumnData[];
  users: UserOption[];
  progressColumnId: string | null;
  ganttStartColumnId: string | null;
  ganttDurationColumnId: string | null;
  ganttEndColumnId: string | null;
  predColumnId?: string | null;
  /** For the 相關項目 list's Link labels — see listDependentItems. */
  linkColumnId?: string | null;
  /** What this item's predecessor's state means for it — see resolvePredLamp. */
  predLamp?: PredLamp | null;
  /** Total float from the CPM backward pass — see computeCriticalPath. */
  scheduleFloat?: ScheduleFloat;
  groupItems?: ItemData[];
  /** 這個分組以外的可選前置(含同群組其他看板的)。 */
  crossGroupPredOptions?: PredOption[];
  lockedScheduleFields?: Map<string, ScheduleLock>;
  /** What to tell the user to edit instead when a Start/Days/Finish field
   *  is locked — see manualScheduleHint in @/lib/gantt. */
  manualScheduleHint?: string;
  userRole: UserRole;
  currentUserId: string;
}) {
  const [todoStats, setTodoStats] = useState<{ done: number; total: number } | null>(null);
  const { notify } = useDialogs();
  const [name, setName] = useState(item.name);
  // Resync the local draft when a different item's name arrives (switching
  // items, or another user's rename) — adjusted during render, not an
  // effect, so it doesn't fight the field while the user is mid-edit.
  const [prevItemName, setPrevItemName] = useState({ id: item.id, name: item.name });
  if (prevItemName.id !== item.id || prevItemName.name !== item.name) {
    setPrevItemName({ id: item.id, name: item.name });
    setName(item.name);
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const todos = await listTodoItems(item.id);
      if (!cancelled) setTodoStats({ done: todos.filter((t) => t.done).length, total: todos.length });
    })();
    return () => {
      cancelled = true;
    };
  }, [item.id]);

  const valuesByColumn = new Map(
    item.cellValues.map((cv) => [cv.columnId, cv.value as string | number | null])
  );
  const canEditStructure = canManageStructure(userRole);
  const canModifySchedule = canModifyItemSchedule(userRole, item.createdById, currentUserId);
  const personColumnIds = columns.filter((c) => c.type === "PERSON").map((c) => c.id);
  const isAssignedToUser = isItemAssignedToUser(item, personColumnIds, currentUserId);
  const lock = lockedScheduleFields?.get(item.id);
  const wbsCodes = groupItems ? computeWbsCodes(groupItems) : undefined;
  const wbsCode = wbsCodes?.get(item.id);
  const parent = groupItems?.find((i) => i.id === item.parentId);
  const parentWbsCode = parent ? wbsCodes?.get(parent.id) : undefined;
  const createdByName = users.find((u) => u.id === item.createdById)?.name;
  // How far this item has drifted from the plan saved for it. Null until the
  // board has a baseline, or for an item created after one was taken.
  // Compared against the stored Start/Finish rather than a recomputed range:
  // those cells are what scheduling actually wrote, and reading them needs no
  // duration mode or holiday list here.
  const currentStart = ganttStartColumnId ? valuesByColumn.get(ganttStartColumnId) : null;
  const currentEnd = ganttEndColumnId ? valuesByColumn.get(ganttEndColumnId) : null;
  const baseline =
    typeof currentStart === "string" && typeof currentEnd === "string"
      ? resolveBaselineVariance(item, { start: new Date(currentStart), end: new Date(currentEnd) })
      : null;
  // Who is scheduled off this item — the other side of Pred, which on its own
  // only says what this item points at.
  const dependents = groupItems
    ? listDependentItems(item.id, groupItems, {
        predColumnId,
        linkColumnId,
        linkColumnOptions: columns.find((c) => c.id === linkColumnId)?.options,
        startColumnId: ganttStartColumnId,
        endColumnId: ganttEndColumnId,
      })
    : [];

  function saveName() {
    if (name.trim() && name !== item.name) {
      renameItem(boardId, item.id, name.trim());
    } else {
      setName(item.name);
    }
  }

  return (
    <div className="overflow-hidden rounded-md border border-neutral-200 dark:border-neutral-700">
      <div className="border-b border-neutral-100 dark:border-neutral-700 px-4 py-3">
        <p className="mb-1 text-xs text-neutral-400 dark:text-neutral-500">項目名稱</p>
        <div className="flex items-center gap-2">
          {wbsCode && (
            <span className="shrink-0 text-sm font-medium text-neutral-400 dark:text-neutral-500">
              {wbsCode}
            </span>
          )}
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={saveName}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur();
            }}
            readOnly={!canEditStructure}
            className="w-full rounded px-1 py-0.5 text-sm font-medium text-neutral-900 dark:text-neutral-100 outline-none hover:bg-neutral-100 dark:hover:bg-neutral-800 focus:bg-white dark:focus:bg-neutral-900 focus:ring-1 focus:ring-blue-400"
          />
        </div>
      </div>
      {columns.map((col) => {
        const isScheduleColumn =
          col.id === ganttStartColumnId || col.id === ganttDurationColumnId || col.id === ganttEndColumnId;
        const isLockedField =
          (col.id === ganttStartColumnId && lock?.startLocked) ||
          (col.id === ganttEndColumnId && lock?.endLocked) ||
          (col.id === ganttDurationColumnId && lock?.daysLocked);
        const canEdit =
          canEditCellValue(userRole, col.type, col.id === progressColumnId, isAssignedToUser) &&
          (!isScheduleColumn || canModifySchedule) &&
          !isLockedField;
        const scheduleBlockedReason =
          isScheduleColumn && !canEdit
            ? !canModifySchedule
              ? "權限不足:僅建立者或管理者可以修改此項目的時程"
              : isLockedField
                ? (manualScheduleHint ??
                  "此日期由前置依賴、子項目統計或里程碑規則自動計算,請改天數、前置依賴或子項目設定")
                : null
            : null;
        return (
          <div key={col.id}>
            <div
              className={`flex items-center justify-between border-b border-neutral-100 dark:border-neutral-700 px-4 py-2.5 ${
                scheduleBlockedReason ? "cursor-not-allowed" : ""
              }`}
              title={
                isLockedField ? (manualScheduleHint ?? "由前置依賴或子項目統計自動計算") : undefined
              }
              onClick={scheduleBlockedReason ? () => notify(scheduleBlockedReason) : undefined}
            >
              <span className="flex items-center gap-1.5 text-xs text-neutral-400 dark:text-neutral-500">
                {col.id === predColumnId && <PredLampDot lamp={predLamp} />}
                {col.name}
              </span>
              <span className="w-40 text-sm text-neutral-800 dark:text-neutral-100">
                <CellEditor
                  boardId={boardId}
                  itemId={item.id}
                  column={col}
                  value={valuesByColumn.get(col.id) ?? null}
                  users={users}
                  canEdit={canEdit}
                  isProgressColumn={col.id === progressColumnId}
                  predColumnId={predColumnId}
                  groupItems={groupItems}
                  crossGroupPredOptions={crossGroupPredOptions}
                  bordered
                />
              </span>
            </div>
            {col.name === "Lvl" && (
              <div className="flex items-center justify-between border-b border-neutral-100 dark:border-neutral-700 px-4 py-2.5">
                <span className="text-xs text-neutral-400 dark:text-neutral-500">父項</span>
                <span className="w-40 truncate text-right text-sm text-neutral-800 dark:text-neutral-100">
                  {parent ? `${parentWbsCode ? `${parentWbsCode} ` : ""}${parent.name}` : "—"}
                </span>
              </div>
            )}
            {col.name === "Lvl" && <DependentItemsRow dependents={dependents} />}
            {col.name === "Lvl" && (
              <ConstraintRow
                itemId={item.id}
                type={item.constraintType}
                date={item.constraintDate}
                canEdit={canModifySchedule}
                currentEnd={typeof currentEnd === "string" ? currentEnd : null}
                durationDays={
                  ganttDurationColumnId
                    ? (() => {
                        const value = valuesByColumn.get(ganttDurationColumnId);
                        return typeof value === "number" ? value : null;
                      })()
                    : null
                }
              />
            )}
            {col.name === "Lvl" && scheduleFloat && (
              <div className="flex items-center justify-between border-b border-neutral-100 dark:border-neutral-700 px-4 py-2.5">
                <span className="text-xs text-neutral-400 dark:text-neutral-500">總浮時</span>
                <span className="text-right text-sm text-neutral-800 dark:text-neutral-100">
                  {scheduleFloat.totalFloat > 0
                    ? `${scheduleFloat.totalFloat} 天`
                    : scheduleFloat.totalFloat === 0
                      ? "0 天"
                      : `落後 ${Math.abs(scheduleFloat.totalFloat)} 天`}
                  {scheduleFloat.isCritical && (
                    <span className="ml-2 rounded bg-red-100 px-1.5 py-0.5 text-xs font-medium text-red-700 dark:bg-red-950 dark:text-red-300">
                      要徑
                    </span>
                  )}
                  <span className="ml-2 text-xs text-neutral-500 dark:text-neutral-400">
                    最晚 {scheduleFloat.lateFinish.toISOString().slice(0, 10)}
                  </span>
                </span>
              </div>
            )}
            {col.name === "Lvl" && baseline && (
              <div className="flex items-center justify-between border-b border-neutral-100 dark:border-neutral-700 px-4 py-2.5">
                <span className="text-xs text-neutral-400 dark:text-neutral-500">基準線</span>
                <span className="text-right text-sm text-neutral-800 dark:text-neutral-100">
                  {item.baselineStart} ~ {item.baselineEnd}
                  <span
                    className={`ml-2 text-xs font-medium ${
                      baseline.status === "late"
                        ? "text-red-600"
                        : baseline.status === "ahead"
                          ? "text-green-600"
                          : "text-neutral-500 dark:text-neutral-400"
                    }`}
                  >
                    {describeBaselineDelta(baseline.endDelta)}
                  </span>
                </span>
              </div>
            )}
          </div>
        );
      })}
      <div className="flex items-center justify-between border-b border-neutral-100 dark:border-neutral-700 px-4 py-2.5">
        <span className="text-xs text-neutral-400 dark:text-neutral-500">任務派遣人</span>
        <span className="w-40 truncate text-right text-sm text-neutral-800 dark:text-neutral-100">
          {createdByName ?? "—"}
        </span>
      </div>
      {todoStats && (
        <div className="flex items-center justify-between px-4 py-2.5">
          <span className="text-xs text-neutral-400 dark:text-neutral-500">待辦事項</span>
          <span className="text-sm text-neutral-800 dark:text-neutral-100">
            {todoStats.done} / {todoStats.total} 已完成
          </span>
        </div>
      )}
    </div>
  );
}
