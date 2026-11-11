"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { previewDragCascade } from "@/lib/actions/predecessorSchedule";
import { resizeItemBar } from "@/lib/actions/ganttResize";
import { describeCascade, describeConflicts } from "@/lib/cascadeText";
import type { CascadedItem, ConstraintConflict } from "@/lib/predecessorLink";
import type { UserRole } from "@prisma/client";
import { listTodoItems } from "@/lib/actions/todo";
import { renameItem } from "@/lib/actions/item";
import { canEditCellValue, canManageStructure, canModifyItemSchedule } from "@/lib/permissions";
import { isItemAssignedToUser } from "@/lib/itemAssignment";
import type { ScheduleLock } from "@/lib/predecessorLink";
import { pinnedScheduleReason } from "@/lib/constraints";
import { computeWbsCodes } from "@/lib/wbs";
import { listDependentItems } from "@/lib/predecessorLink";
import { DependentItemsRow } from "../DependentItemsRow";
import { PredLampDot } from "../PredLampDot";
import { ConstraintRow } from "./ConstraintRow";
import { StatusTimes } from "./StatusTimes";
import { formatEventDateTime, pickStatusColumnId } from "@/lib/itemEvents";
import { resolveBaselineVariance, describeBaselineDelta } from "@/lib/baseline";
import type { PredLamp } from "@/lib/predLamp";
import type { ScheduleFloat } from "@/lib/criticalPath";
import { CellEditor } from "../cell-editors/CellEditor";
import { useCrossGroupPredOptions } from "../cell-editors/useCrossGroupPredOptions";
import { RollupProgress } from "../RollupProgress";
import { computeItemProgress } from "@/lib/progress";
import { OwnerAllocationInput } from "../OwnerAllocationInput";
import { AssignmentEditor } from "../AssignmentEditor";
import { ItemProtoUnitsField } from "../ItemProtoUnitsField";
import { useDialogs } from "@/components/ui/DialogProvider";
import { useEditHistory } from "../EditHistoryProvider";
import type { UndoResult } from "@/lib/editHistory";
import type { ColumnData, ItemData, UserOption, PredOption } from "@/types/board";
import { actionErrorMessage, knownErrorMessage } from "@/lib/userError";

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
  crossGroupPredOptions: providedCrossGroupPredOptions,
  onAssignmentChanged,
  lockedScheduleFields,
  manualScheduleHint,
  userRole,
  currentUserId,
  highlightField,
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
  /** 人員分配改了之後,呼叫端可能要重畫甘特圖的長條或工作量。 */
  onAssignmentChanged?: () => void;
  lockedScheduleFields?: Map<string, ScheduleLock>;
  /** What to tell the user to edit instead when a Start/Days/Finish field
   *  is locked — see manualScheduleHint in @/lib/gantt. */
  manualScheduleHint?: string;
  userRole: UserRole;
  currentUserId: string;
  /** 從「更新記錄」點進來:要標出來的欄位名稱(捲到那一列、閃一下)。 */
  highlightField?: string | null;
}) {
  const crossGroupPredOptions = useCrossGroupPredOptions(
    boardId,
    item.groupId,
    providedCrossGroupPredOptions,
    !!predColumnId
  );
  // 閃著標出來的欄位:一開始等畫面排好再捲過去,幾秒後自己消掉。
  const [flashField, setFlashField] = useState<string | null>(null);
  useEffect(() => {
    if (!highlightField) return;
    const show = setTimeout(() => {
      const row = [...document.querySelectorAll<HTMLElement>("[data-card-field]")].find((el) => el.dataset.cardField === highlightField);
      row?.scrollIntoView({ block: "center" });
      setFlashField(highlightField);
    }, 150);
    const hide = setTimeout(() => setFlashField(null), 3500);
    return () => {
      clearTimeout(show);
      clearTimeout(hide);
    };
  }, [highlightField]);
  const [todoStats, setTodoStats] = useState<{ done: number; total: number } | null>(null);
  const { notify, confirm } = useDialogs();
  const router = useRouter();
  const history = useEditHistory();
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
  // 有子項目的項目,進度是子項目的平均(見 computeItemProgress),自己填的數字不算——卡片跟表格一樣只顯示。
  const childCount = groupItems ? groupItems.filter((i) => i.parentId === item.id).length : 0;
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

  /** 實際完成比預定晚:把這個工作項的結束日改成實際完成日,依賴它的後續工作項由排程連動順延。
   *  先預覽會動到誰、經 PM 確認才寫入;基準線(原計畫)不動,事後仍可比較。 */
  async function shiftToActualFinish(actualDate: string) {
    if (typeof currentStart !== "string" || typeof currentEnd !== "string") return;
    let cascaded: CascadedItem[] = [];
    let conflicts: ConstraintConflict[] = [];
    try {
      ({ cascaded, conflicts } = await previewDragCascade(boardId, item.id, currentStart.slice(0, 10), actualDate));
    } catch {
      // 預覽失敗不擋:只是少了連動清單。
    }
    const ok = await confirm(
      [
        `把「${item.name}」的結束日從 ${currentEnd.slice(0, 10)} 改成實際完成日 ${actualDate}。`,
        ...describeCascade(cascaded),
        ...describeConflicts(conflicts),
        "",
        "原計畫(基準線)不會變,之後仍可以跟原計畫比較。確定要順延嗎?",
      ].join("\n"),
      { title: "依實際完成日順延" }
    );
    if (!ok) return;
    try {
      await resizeItemBar(boardId, item.id, "end", actualDate);
      router.refresh();
    } catch (err) {
      await notify(actionErrorMessage(err, "順延失敗"), { title: "無法順延" });
    }
  }

  function recordRename(before: string, after: string) {
    if (!history) return;
    const apply = async (expected: string, target: string): Promise<UndoResult> => {
      const current = history.getBoard().items.find((i) => i.id === item.id);
      if (!current) return { ok: false, reason: "這個項目已經不存在,沒有執行。" };
      if (current.name !== expected) {
        return { ok: false, reason: "這個項目的名稱已經被改過,為了不蓋掉新的修改,沒有執行。" };
      }
      try {
        await renameItem(boardId, item.id, target);
        return { ok: true };
      } catch (err) {
        return { ok: false, reason: actionErrorMessage(err, "改名失敗") };
      }
    };
    history.record({
      label: `重新命名「${before}」`,
      undo: () => apply(after, before),
      redo: () => apply(before, after),
    });
  }

  function saveName() {
    if (name.trim() && name !== item.name) {
      const before = item.name;
      const after = name.trim();
      renameItem(boardId, item.id, after)
        .then(() => recordRename(before, after))
        .catch((err) => notify(knownErrorMessage(err, "儲存失敗,請重新整理後再試一次。"), { title: "無法儲存" }));
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
        const statusColumnId = pickStatusColumnId(columns);
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
        // 完成日被「必須完成於」釘住時,日期欄鎖住的原因是這條約束,不是前置依賴。
        const pinnedReason =
          col.id === ganttDurationColumnId
            ? null
            : pinnedScheduleReason({ type: item.constraintType, date: item.constraintDate });
        const scheduleBlockedReason =
          isScheduleColumn && !canEdit
            ? !canModifySchedule
              ? "權限不足:僅建立者或管理者可以修改此項目的時程"
              : isLockedField
                ? (pinnedReason ??
                  manualScheduleHint ??
                  "此日期由前置依賴、子項目統計或里程碑規則自動計算,請改天數、前置依賴或子項目設定")
                : null
            : null;
        return (
          <div
            key={col.id}
            data-card-field={col.name}
            className={flashField === col.name ? "rounded bg-amber-50 ring-2 ring-amber-400 transition dark:bg-amber-950/30" : "transition"}
          >
            <div
              className={`flex items-center justify-between border-b border-neutral-100 dark:border-neutral-700 px-4 py-2.5 ${
                scheduleBlockedReason ? "cursor-not-allowed" : ""
              }`}
              title={
                isLockedField ? (pinnedReason ?? manualScheduleHint ?? "由前置依賴或子項目統計自動計算") : undefined
              }
              onClick={scheduleBlockedReason ? () => notify(scheduleBlockedReason) : undefined}
            >
              <span className="flex items-center gap-1.5 text-xs text-neutral-400 dark:text-neutral-500">
                {col.id === predColumnId && <PredLampDot lamp={predLamp} />}
                {col.name}
              </span>
              <span className="w-40 text-sm text-neutral-800 dark:text-neutral-100">
                {col.id === progressColumnId && childCount > 0 && groupItems ? (
                  <RollupProgress value={computeItemProgress(item, groupItems, col.id)} childCount={childCount} />
                ) : (
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
                )}
              </span>
            </div>
            {/* 狀態欄下面:什麼時候切成進行中、什麼時候切成完成。 */}
            {col.id === statusColumnId && (
              <StatusTimes
                itemId={item.id}
                statusValue={valuesByColumn.get(col.id) ?? null}
                late={{
                  plannedEnd: typeof currentEnd === "string" ? currentEnd : null,
                  dependentCount: dependents.length,
                  // 這裡的 lock 在「一律自動計算」的看板上是每一欄都鎖(輸出欄),不能拿來擋:
                  // 真正不能改的情況(結束日由前置、子項目、里程碑算出來)由伺服器擋下並說明原因。
                  onShift: canModifySchedule ? shiftToActualFinish : undefined,
                }}
              />
            )}
            {col.id === progressColumnId && childCount > 0 && (
              <p className="border-b border-neutral-100 px-4 py-1.5 text-[11px] text-neutral-400 dark:border-neutral-700 dark:text-neutral-500">
                這個項目有 {childCount} 個子項目,進度是它們的平均(沒填的算 0%)。要改請到子項目填進度。
              </p>
            )}
            {col.name === "負責人" && col.type === "PERSON" && (
              <div className="flex justify-end border-b border-neutral-100 dark:border-neutral-700 px-4 py-2">
                <OwnerAllocationInput
                  boardId={boardId}
                  item={item}
                  ownerId={(valuesByColumn.get(col.id) as string | null | undefined) ?? null}
                  users={users}
                  canEdit={canEdit}
                />
              </div>
            )}
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
      <ItemProtoUnitsField
        itemId={item.id}
        canEdit={canEditCellValue(userRole, "STATUS", false, isAssignedToUser)}
        className="flex items-center justify-between border-b border-neutral-100 px-4 py-2.5 dark:border-neutral-700"
        labelClassName="text-neutral-400 dark:text-neutral-500"
      />
      <div className="border-b border-neutral-100 px-4 py-3 dark:border-neutral-700">
        <p className="mb-2 text-xs text-neutral-400 dark:text-neutral-500">
          人員分配
          <span className="ml-1.5 text-neutral-300 dark:text-neutral-600">
            投入百分比,會換算成工時與成本
          </span>
        </p>
        <AssignmentEditor
          boardId={boardId}
          itemId={item.id}
          users={users}
          userRole={userRole}
          currentUserId={currentUserId}
          onChanged={onAssignmentChanged}
        />
      </div>
      <div className="flex items-center justify-between border-b border-neutral-100 dark:border-neutral-700 px-4 py-2.5">
        <span className="text-xs text-neutral-400 dark:text-neutral-500">任務派遣人</span>
        <span className="w-40 truncate text-right text-sm text-neutral-800 dark:text-neutral-100">
          {createdByName ?? "—"}
        </span>
      </div>
      <div
        data-dispatch-time
        className="flex items-center justify-between border-b border-neutral-100 dark:border-neutral-700 px-4 py-2.5"
      >
        <span className="text-xs text-neutral-400 dark:text-neutral-500">任務派遣時間</span>
        <span className="text-right text-sm text-neutral-800 dark:text-neutral-100">{formatEventDateTime(item.createdAt)}</span>
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
