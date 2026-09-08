"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/ui/Modal";
import { Trash2 } from "lucide-react";
import type { ColumnData, ItemData, UserOption } from "@/types/board";
import type { UserRole } from "@prisma/client";
import { listAssignments, upsertAssignment, removeAssignment } from "@/lib/actions/assignment";
import { upsertCellValue } from "@/lib/actions/cell";
import { previewSchedule } from "@/lib/actions/predecessorSchedule";
import { listDependentItems, type SchedulePreview } from "@/lib/predecessorLink";
import { DependentItemsRow } from "./DependentItemsRow";
import { Avatar } from "@/components/ui/Avatar";
import { PersonPicker } from "@/components/ui/PersonPicker";
import { CellEditor } from "./cell-editors/CellEditor";
import { PredPicker } from "./cell-editors/PredPicker";
import { getStatusOptions } from "@/types/column";
import { computeWbsCodes } from "@/lib/wbs";

export function AssignmentModal({
  boardId,
  item,
  users,
  currentUserId,
  userRole,
  open,
  onOpenChange,
  columns,
  predColumnId,
  linkColumnId,
  lagColumnId,
  durationColumnId,
  manualStartColumnId,
  ganttStartColumnId,
  ganttEndColumnId,
  canEditSchedule = false,
  groupItems,
  onScheduleApplied,
}: {
  boardId: string;
  item: ItemData | null;
  users: UserOption[];
  currentUserId: string;
  userRole: UserRole;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Pred/Link/Lag/Duration columns, shown as an extra "時程設定" section
   *  when provided — used by the Gantt view so clicking a bar can edit
   *  these alongside people, instead of needing the full item-detail card.
   *  Gated by canEditSchedule (the same permission that let the modal open
   *  at all), not a separate per-field check. */
  columns?: ColumnData[];
  predColumnId?: string | null;
  linkColumnId?: string | null;
  lagColumnId?: string | null;
  /** The board's actual manual-duration input — manualDurationColumnId
   *  when the board has one configured, else the classic ganttDurationColumnId
   *  ("Days"). Whichever one the item's Start/Finish are actually derived
   *  from, so setting it here has the same effect as editing it directly. */
  durationColumnId?: string | null;
  /** The board's manual-start input ("start(set)") — only set when the
   *  board is in "always computed" mode. Shown as an editable field
   *  alongside duration, since it's the other half of a chain-root item's
   *  base range (Pred/Link only override it for non-root items). */
  manualStartColumnId?: string | null;
  /** Start/Finish columns — shown alongside the fields above as a plain,
   *  never-editable display of the computed result, so changing Pred/Link/
   *  Lag/Duration has somewhere to show its effect before it's applied. */
  ganttStartColumnId?: string | null;
  ganttEndColumnId?: string | null;
  canEditSchedule?: boolean;
  /** Every item in the same group as `item` — used to build the Pred
   *  dropdown (item name -> its WBS code, since that's what's actually
   *  stored) instead of making the user type a WBS code by hand. */
  groupItems?: ItemData[];
  /** Called after a schedule field is saved, for callers whose `item` is a
   *  fetched snapshot rather than a prop that router.refresh() updates —
   *  otherwise the recomputed Start/Finish never reach the display above. */
  onScheduleApplied?: () => void;
}) {
  const router = useRouter();
  const [assignments, setAssignments] = useState<
    Awaited<ReturnType<typeof listAssignments>>
  >([]);
  const [loading, setLoading] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState("");
  const [pct, setPct] = useState(10);
  const [pendingChange, setPendingChange] = useState<{
    columnId: string;
    value: string | number | null;
    preview: SchedulePreview;
  } | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [draftNumber, setDraftNumber] = useState<{ columnId: string; text: string } | null>(null);

  // Reset the schedule-editing state whenever a different item opens, without
  // doing it inside the fetch effect below (which would trigger the
  // react-hooks/set-state-in-effect rule) — adjust state during render instead.
  const openItemKey = open && item ? item.id : null;
  const [prevOpenItemKey, setPrevOpenItemKey] = useState<string | null>(null);
  if (openItemKey !== prevOpenItemKey) {
    setPrevOpenItemKey(openItemKey);
    setPendingChange(null);
    setDraftNumber(null);
  }

  useEffect(() => {
    if (!open || !item) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const result = await listAssignments(item.id);
        if (!cancelled) setAssignments(result);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, item]);

  // Who is scheduled off this item — the other side of Pred, which on its own
  // only says what this item points at.
  const dependents = useMemo(
    () =>
      item && groupItems
        ? listDependentItems(item.id, groupItems, {
            predColumnId,
            linkColumnId,
            linkColumnOptions: columns?.find((c) => c.id === linkColumnId)?.options,
            startColumnId: ganttStartColumnId,
            endColumnId: ganttEndColumnId,
          })
        : [],
    [item, groupItems, columns, predColumnId, linkColumnId, ganttStartColumnId, ganttEndColumnId]
  );

  if (!item) return null;

  async function handleScheduleFieldChange(columnId: string, value: string | number | null) {
    if (!item) return;
    setPreviewLoading(true);
    try {
      const preview = await previewSchedule(boardId, item.id, columnId, value);
      const currentStart = ganttStartColumnId
        ? (item.cellValues.find((cv) => cv.columnId === ganttStartColumnId)?.value as string | undefined) ?? null
        : null;
      const currentEnd = ganttEndColumnId
        ? (item.cellValues.find((cv) => cv.columnId === ganttEndColumnId)?.value as string | undefined) ?? null
        : null;
      if (!preview || (preview.start === currentStart && preview.end === currentEnd)) {
        await upsertCellValue(boardId, item.id, columnId, value);
        router.refresh();
        onScheduleApplied?.();
        return;
      }
      setPendingChange({ columnId, value, preview });
    } finally {
      setPreviewLoading(false);
    }
  }

  async function confirmPendingChange() {
    if (!item || !pendingChange) return;
    await upsertCellValue(boardId, item.id, pendingChange.columnId, pendingChange.value);
    setPendingChange(null);
    router.refresh();
    onScheduleApplied?.();
  }

  function cancelPendingChange() {
    setPendingChange(null);
  }

  const scheduleColumns = [predColumnId, linkColumnId, lagColumnId, durationColumnId, manualStartColumnId]
    .map((id) => columns?.find((c) => c.id === id))
    .filter((c): c is ColumnData => !!c);

  // Item name -> its WBS code, so Pred can be picked from a list instead of
  // typed by hand — codes are group-scoped (same rule as the lock check and
  // the table's own WBS badges), so this only ever offers items from the
  // same group `item` is in.
  const predCodes = groupItems ? computeWbsCodes(groupItems) : null;
  const predOptions =
    groupItems && predCodes
      ? groupItems
          .filter((i) => i.id !== item.id)
          .map((i) => ({ id: i.id, code: predCodes.get(i.id) ?? "", name: i.name }))
          .filter((o) => o.code)
          .sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }))
      : [];
  const parentCode = item.parentId ? (predCodes?.get(item.parentId) ?? undefined) : undefined;

  // Gantt Assignments reference a real User row (foreign key) — Resources
  // (tools/vendors) can be a PERSON-column 負責人 but not a %-allocation here.
  const realUsers = users.filter((u) => !u.isResource);
  const assignableUsers =
    userRole === "SUPERVISOR"
      ? realUsers.filter((u) => u.supervisorId === currentUserId)
      : realUsers;

  const assignedUserIds = new Set(assignments.map((a) => a.userId));
  const availableUsers = assignableUsers.filter((u) => !assignedUserIds.has(u.id));

  async function refresh() {
    if (!item) return;
    setAssignments(await listAssignments(item.id));
  }

  async function handleAdd() {
    if (!item || !selectedUserId) return;
    await upsertAssignment(boardId, item.id, selectedUserId, pct);
    setSelectedUserId("");
    setPct(10);
    await refresh();
  }

  async function handleRemove(userId: string) {
    if (!item) return;
    await removeAssignment(boardId, item.id, userId);
    await refresh();
  }

  async function handleUpdatePct(userId: string, nextPct: number) {
    if (!item) return;
    await upsertAssignment(boardId, item.id, userId, nextPct);
    await refresh();
  }

  return (
    <Modal open={open} onOpenChange={onOpenChange} title={`${item.name} — 人員分配`} size="lg">
      <div className="mb-4 space-y-2">
        {loading && <p className="text-sm text-neutral-400 dark:text-neutral-500">載入中...</p>}
        {!loading && assignments.length === 0 && (
          <p className="text-sm text-neutral-400 dark:text-neutral-500">尚未指派人員</p>
        )}
        {assignments.map((a) => (
          <div
            key={a.userId}
            className="flex items-center justify-between rounded-md bg-neutral-50 dark:bg-neutral-800 px-3 py-2"
          >
            <span className="flex min-w-0 items-center gap-2 text-sm text-neutral-800 dark:text-neutral-100">
              <Avatar name={a.user.name} avatarUrl={a.user.avatarUrl} size={22} />
              <span className="truncate">{a.user.name}</span>
            </span>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={5}
                max={100}
                step={5}
                value={a.allocationPct}
                onChange={(e) => handleUpdatePct(a.userId, Number(e.target.value))}
                className="w-16 rounded-md border border-neutral-300 dark:border-neutral-600 dark:bg-neutral-900 px-2 py-1 text-right text-sm outline-none focus:border-blue-500"
              />
              <span className="text-sm text-neutral-500 dark:text-neutral-400">%</span>
              <button
                type="button"
                onClick={() => handleRemove(a.userId)}
                className="text-neutral-400 dark:text-neutral-500 hover:text-red-600"
                aria-label="移除"
              >
                <Trash2 size={14} />
              </button>
            </div>
          </div>
        ))}
      </div>

      {availableUsers.length > 0 ? (
        <div className="flex items-center gap-2">
          <div className="flex-1 rounded-md border border-neutral-300 dark:border-neutral-600">
            <PersonPicker
              users={availableUsers}
              selectedId={selectedUserId || null}
              onSelect={(userId) => setSelectedUserId(userId ?? "")}
            />
          </div>
          <input
            type="number"
            min={5}
            max={100}
            step={5}
            value={pct}
            onChange={(e) => setPct(Number(e.target.value))}
            className="w-20 rounded-md border border-neutral-300 dark:border-neutral-600 dark:bg-neutral-900 px-2 py-1.5 text-sm outline-none focus:border-blue-500"
          />
          <span className="text-sm text-neutral-500 dark:text-neutral-400">%</span>
          <button
            type="button"
            disabled={!selectedUserId}
            onClick={handleAdd}
            className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            新增
          </button>
        </div>
      ) : (
        userRole === "SUPERVISOR" && (
          <p className="text-sm text-neutral-400 dark:text-neutral-500">你的團隊目前沒有可指派的成員。</p>
        )
      )}

      {scheduleColumns.length > 0 && (
        <div className="mt-4 space-y-3 border-t border-neutral-100 dark:border-neutral-700 pt-4">
          <h3 className="text-xs font-semibold text-neutral-500 dark:text-neutral-400">時程設定</h3>

          {(ganttStartColumnId || ganttEndColumnId) &&
            (() => {
              const startValue = ganttStartColumnId
                ? ((item.cellValues.find((cv) => cv.columnId === ganttStartColumnId)?.value as
                    | string
                    | undefined) ?? null)
                : null;
              const endValue = ganttEndColumnId
                ? ((item.cellValues.find((cv) => cv.columnId === ganttEndColumnId)?.value as
                    | string
                    | undefined) ?? null)
                : null;
              return (
                <div className="grid grid-cols-2 gap-3 rounded-md bg-neutral-50 dark:bg-neutral-800 px-3 py-2 text-sm">
                  {ganttStartColumnId && (
                    <div>
                      <span className="text-xs text-neutral-500 dark:text-neutral-400">Start</span>
                      <p className="text-neutral-800 dark:text-neutral-100">
                        {startValue ?? "未設定"}
                        {pendingChange && pendingChange.preview.start !== startValue && (
                          <span className="ml-1 font-medium text-blue-600">
                            → {pendingChange.preview.start}
                          </span>
                        )}
                      </p>
                    </div>
                  )}
                  {ganttEndColumnId && (
                    <div>
                      <span className="text-xs text-neutral-500 dark:text-neutral-400">Finish</span>
                      <p className="text-neutral-800 dark:text-neutral-100">
                        {endValue ?? "未設定"}
                        {pendingChange && pendingChange.preview.end !== endValue && (
                          <span className="ml-1 font-medium text-blue-600">
                            → {pendingChange.preview.end}
                          </span>
                        )}
                      </p>
                    </div>
                  )}
                </div>
              );
            })()}

          {pendingChange && (
            <div className="flex items-center justify-between rounded-md border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950 px-3 py-2 text-xs text-blue-800 dark:text-blue-300">
              <span>此變更將調整時程,是否套用?</span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={cancelPendingChange}
                  className="rounded px-2 py-1 text-neutral-600 dark:text-neutral-400 hover:bg-white dark:hover:bg-neutral-900"
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={confirmPendingChange}
                  className="rounded bg-blue-600 px-2 py-1 font-medium text-white hover:bg-blue-700"
                >
                  確認套用
                </button>
              </div>
            </div>
          )}

          <DependentItemsRow dependents={dependents} className="border-t border-neutral-100 dark:border-neutral-700 pt-3" />

          {scheduleColumns.map((col) => {
            const rawValue = item.cellValues.find((cv) => cv.columnId === col.id)?.value as
              | string
              | number
              | null
              | undefined;
            const displayValue = pendingChange?.columnId === col.id ? pendingChange.value : (rawValue ?? null);
            const isPredWithOptions = col.id === predColumnId && groupItems;
            const fieldDisabled = !canEditSchedule || previewLoading;
            const selectClass =
              "w-full rounded border-none bg-transparent px-2 py-1 text-sm outline-none hover:bg-neutral-50 dark:hover:bg-neutral-800 focus:bg-white dark:focus:bg-neutral-900 focus:ring-1 focus:ring-blue-400 disabled:opacity-50";
            return (
              <div key={col.id} className="flex items-center justify-between gap-3">
                <span className="shrink-0 text-xs text-neutral-500 dark:text-neutral-400">{col.name}</span>
                <div className="w-56">
                  {isPredWithOptions ? (
                    <PredPicker
                      value={typeof displayValue === "string" ? displayValue : null}
                      options={predOptions}
                      parentCode={parentCode}
                      disabled={fieldDisabled}
                      onChange={(next) => handleScheduleFieldChange(col.id, next)}
                    />
                  ) : col.type === "STATUS" ? (
                    <select
                      value={typeof displayValue === "string" ? displayValue : ""}
                      disabled={fieldDisabled}
                      onChange={(e) => handleScheduleFieldChange(col.id, e.target.value || null)}
                      className={selectClass}
                    >
                      <option value="">未設定</option>
                      {getStatusOptions(col.options).map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  ) : col.type === "NUMBER" ? (
                    <input
                      type="number"
                      value={
                        draftNumber?.columnId === col.id
                          ? draftNumber.text
                          : (typeof displayValue === "number" ? displayValue : "")
                      }
                      disabled={fieldDisabled}
                      onChange={(e) => setDraftNumber({ columnId: col.id, text: e.target.value })}
                      onBlur={(e) => {
                        setDraftNumber(null);
                        const next = e.target.value === "" ? null : Number(e.target.value);
                        const current = typeof rawValue === "number" ? rawValue : null;
                        if (next !== current) handleScheduleFieldChange(col.id, next);
                      }}
                      className="w-full rounded border-none bg-transparent px-2 py-1 text-sm outline-none hover:bg-neutral-50 dark:hover:bg-neutral-800 focus:bg-white dark:focus:bg-neutral-900 focus:ring-1 focus:ring-blue-400 disabled:opacity-50"
                    />
                  ) : col.type === "DATE" ? (
                    <input
                      type="date"
                      value={typeof displayValue === "string" ? displayValue : ""}
                      disabled={fieldDisabled}
                      onChange={(e) => handleScheduleFieldChange(col.id, e.target.value || null)}
                      className="w-full rounded border-none bg-transparent px-2 py-1 text-sm outline-none hover:bg-neutral-50 dark:hover:bg-neutral-800 focus:bg-white dark:focus:bg-neutral-900 focus:ring-1 focus:ring-blue-400 disabled:opacity-50"
                    />
                  ) : (
                    <CellEditor
                      boardId={boardId}
                      itemId={item.id}
                      column={col}
                      value={rawValue ?? null}
                      users={users}
                      canEdit={false}
                    />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Modal>
  );
}
