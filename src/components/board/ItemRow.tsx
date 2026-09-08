"use client";

import { useEffect, useRef, useState } from "react";
import {
  ArrowDownToLine,
  ArrowUpToLine,
  ChevronDown,
  ChevronRight,
  MessageSquare,
  Plus,
  Trash2,
  UserPlus,
} from "lucide-react";
import type { ItemData, ColumnData, UserOption } from "@/types/board";
import type { UserRole } from "@prisma/client";
import { canManageGroupStructure, canEditCellValue, canModifyItemSchedule } from "@/lib/permissions";
import { isItemAssignedToUser, isItemAssignedToTeam } from "@/lib/itemAssignment";
import { CellEditor } from "./cell-editors/CellEditor";
import { ItemDetailModal } from "./ItemDetailModal";
import { AssignmentModal } from "./AssignmentModal";
import { RowMenu, RowMenuItem } from "@/components/ui/RowMenu";
import { useDialogs } from "@/components/ui/DialogProvider";
import { createItem, insertItem } from "@/lib/actions/item";
import { useDeleteItem } from "./useDeleteItem";
import { computeItemProgress } from "@/lib/progress";
import type { ScheduleLock } from "@/lib/predecessorLink";
import type { PredLamp } from "@/lib/predLamp";
import { PredLampDot } from "./PredLampDot";
import { gridTemplate, frozenPaneWidth } from "./gridTemplate";

export function ItemRow({
  pane,
  boardId,
  groupId,
  item,
  allGroupItems,
  depth = 0,
  columns,
  users,
  progressColumnId,
  ganttStartColumnId,
  ganttDurationColumnId,
  ganttEndColumnId,
  predColumnId,
  linkColumnId,
  lockedScheduleFields,
  userRole,
  currentUserId,
  visibleIds,
  nameWidth,
  wbsCodes,
  highlightItemId,
  expandIds,
  levelColors,
  nameColors,
  predLamps,
  manualScheduleHint,
  collapsedIds,
  onToggleCollapse,
  hasGroupScheduleRole = false,
  hasGroupStructureRole = false,
  groupTeamUserIds,
}: {
  pane: "frozen" | "data";
  boardId: string;
  groupId: string;
  item: ItemData;
  allGroupItems: ItemData[];
  depth?: number;
  columns: ColumnData[];
  users: UserOption[];
  progressColumnId: string | null;
  ganttStartColumnId: string | null;
  ganttDurationColumnId: string | null;
  ganttEndColumnId: string | null;
  predColumnId?: string | null;
  /** For the item card's 相關項目 list — see listDependentItems. */
  linkColumnId?: string | null;
  lockedScheduleFields: Map<string, ScheduleLock>;
  userRole: UserRole;
  currentUserId: string;
  visibleIds: Set<string> | null;
  nameWidth: number;
  wbsCodes?: Map<string, string>;
  highlightItemId?: string | null;
  expandIds?: Set<string>;
  levelColors?: string[];
  nameColors?: Map<string, string>;
  /** Per-item Pred lamp — see resolvePredLamps. */
  predLamps?: Map<string, PredLamp>;
  /** What to change instead, when Start/Days/Finish are computed from the
   *  board's manual schedule columns — see BoardTable. */
  manualScheduleHint?: string;
  collapsedIds: Set<string>;
  onToggleCollapse: (itemId: string) => void;
  /** Group role bypasses — see resolveGroupRoleAccess. hasGroupScheduleRole
   *  (TEAM_LEADER/PMD) unlocks schedule columns group-wide;
   *  hasGroupStructureRole (a discipline DM) unlocks add/insert/assign, and
   *  groupTeamUserIds (that DM's discipline roster) unlocks progress editing
   *  for items assigned to those members. */
  hasGroupScheduleRole?: boolean;
  hasGroupStructureRole?: boolean;
  groupTeamUserIds?: Set<string>;
}) {
  const canEditStructure = canManageGroupStructure(userRole, hasGroupStructureRole);
  const canModifySchedule = canModifyItemSchedule(userRole, item.createdById, currentUserId, hasGroupScheduleRole);
  // Deletion deliberately does NOT get the group-role bypass — a group's
  // TEAM_LEADER/PMD/DM can adjust schedule and add/assign items, but only an
  // ADMIN or the item's own creator can delete it (unchanged from before).
  const canDeleteItem = canModifyItemSchedule(userRole, item.createdById, currentUserId);
  const personColumnIds = columns.filter((c) => c.type === "PERSON").map((c) => c.id);
  const isAssignedToCurrentUser = isItemAssignedToUser(item, personColumnIds, currentUserId);
  const isAssignedToGroupDiscipline =
    !!groupTeamUserIds && groupTeamUserIds.size > 0 && isItemAssignedToTeam(item, personColumnIds, groupTeamUserIds);
  const isAncestorOfHighlight = expandIds?.has(item.id) ?? false;
  const expanded = !collapsedIds.has(item.id) || isAncestorOfHighlight;
  const [detailOpen, setDetailOpen] = useState(false);
  const { notify } = useDialogs();
  const requestDelete = useDeleteItem();
  const [detailTab, setDetailTab] = useState<"updates" | "card">("updates");
  const [assignOpen, setAssignOpen] = useState(false);
  const [newChildItem, setNewChildItem] = useState<ItemData | null>(null);
  const [insertedItem, setInsertedItem] = useState<ItemData | null>(null);
  // Both hold the item as it was when created. Editing a field inside the card
  // saves and router.refresh()es, which updates allGroupItems but not this
  // state — so read the fresh row back out, or a second edit would be computed
  // against the original values (picking a second Pred replaced the first).
  // Falls back to the snapshot until the refresh lands.
  const live = (snapshot: ItemData | null) =>
    snapshot ? (allGroupItems.find((i) => i.id === snapshot.id) ?? snapshot) : null;
  const rowRef = useRef<HTMLDivElement>(null);
  const isHighlighted = item.id === highlightItemId;
  const [flash, setFlash] = useState(false);
  const levelColor = levelColors?.[depth]?.trim() || undefined;
  const rowBackground = flash ? "#fecaca" : levelColor;

  useEffect(() => {
    if (!isHighlighted || !rowRef.current) return;
    rowRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    setFlash(true);
    const timer = setTimeout(() => setFlash(false), 2000);
    return () => clearTimeout(timer);
  }, [isHighlighted]);

  const children = allGroupItems
    .filter((i) => i.parentId === item.id)
    .filter((i) => visibleIds === null || visibleIds.has(i.id))
    .sort((a, b) => a.order - b.order);
  const hasChildren = children.length > 0;
  const commentCount = item._count.comments;

  const valuesByColumn = new Map(
    item.cellValues.map((cv) => [cv.columnId, cv.value as string | number | null])
  );

  async function handleAddSubitem() {
    if (collapsedIds.has(item.id)) onToggleCollapse(item.id);
    const created = await createItem(boardId, groupId, "新子項目", item.id);
    setNewChildItem(created);
  }

  async function handleInsert(position: "before" | "after") {
    const created = await insertItem(boardId, groupId, item.parentId, item.id, position);
    setInsertedItem(created);
  }

  const childRows = expanded
    ? children.map((child) => (
        <ItemRow
          key={child.id}
          pane={pane}
          boardId={boardId}
          groupId={groupId}
          item={child}
          allGroupItems={allGroupItems}
          depth={depth + 1}
          columns={columns}
          users={users}
          progressColumnId={progressColumnId}
          ganttStartColumnId={ganttStartColumnId}
          ganttDurationColumnId={ganttDurationColumnId}
          ganttEndColumnId={ganttEndColumnId}
          predColumnId={predColumnId}
          linkColumnId={linkColumnId}
          lockedScheduleFields={lockedScheduleFields}
          userRole={userRole}
          currentUserId={currentUserId}
          visibleIds={visibleIds}
          nameWidth={nameWidth}
          wbsCodes={wbsCodes}
          highlightItemId={highlightItemId}
          expandIds={expandIds}
          levelColors={levelColors}
          nameColors={nameColors}
          predLamps={predLamps}
          manualScheduleHint={manualScheduleHint}
          collapsedIds={collapsedIds}
          onToggleCollapse={onToggleCollapse}
        />
      ))
    : null;

  if (pane === "frozen") {
    return (
      <>
        <div
          ref={rowRef}
          className="group flex h-9 items-center border-b border-neutral-100 dark:border-neutral-700 hover:bg-neutral-50 dark:hover:bg-neutral-800"
          style={{
            width: frozenPaneWidth(nameWidth),
            backgroundColor: rowBackground,
            transition: "background-color 1.5s ease",
          }}
        >
          <div className="flex h-8 w-8 shrink-0 items-center justify-center">
            {hasChildren && (
              <button
                type="button"
                onClick={() => onToggleCollapse(item.id)}
                className="text-neutral-400 dark:text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-100"
                aria-label={expanded ? "收合子項目" : "展開子項目"}
              >
                {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              </button>
            )}
          </div>
          <div className="flex min-w-0 flex-1 items-center gap-1" style={{ paddingLeft: depth * 20 }}>
            {wbsCodes?.get(item.id) && (
              <span className="shrink-0 text-xs font-bold text-black">{wbsCodes.get(item.id)}</span>
            )}
            <button
              type="button"
              onClick={() => {
                setDetailTab("card");
                setDetailOpen(true);
              }}
              title="編輯此項目所有欄位"
              style={nameColors?.get(item.id) ? { color: nameColors.get(item.id) } : undefined}
              className="min-w-0 flex-1 truncate rounded px-2 py-1.5 text-left text-sm outline-none hover:bg-neutral-100 dark:hover:bg-neutral-800 focus:bg-white dark:focus:bg-neutral-900 focus:ring-1 focus:ring-blue-400"
            >
              {item.name}
            </button>
            <button
              type="button"
              onClick={() => {
                setDetailTab("updates");
                setDetailOpen(true);
              }}
              className={`flex shrink-0 items-center gap-0.5 rounded px-1 py-0.5 text-xs hover:bg-neutral-100 dark:hover:bg-neutral-800 hover:text-neutral-600 dark:hover:text-neutral-400 ${
                commentCount > 0 ? "text-blue-600" : "text-neutral-300 dark:text-neutral-600"
              }`}
              aria-label="留言"
            >
              <MessageSquare size={14} />
              {commentCount > 0 && <span>{commentCount}</span>}
            </button>
            {canEditStructure && (
              <button
                type="button"
                onClick={() => setAssignOpen(true)}
                title={item.assignments.map((a) => `${a.user.name} ${a.allocationPct}%`).join(", ")}
                className={`flex shrink-0 items-center gap-0.5 rounded px-1 py-0.5 text-xs hover:bg-neutral-100 dark:hover:bg-neutral-800 hover:text-neutral-600 dark:hover:text-neutral-400 ${
                  item.assignments.length > 0 ? "text-blue-600" : "text-neutral-300 dark:text-neutral-600"
                }`}
                aria-label="指派"
              >
                <UserPlus size={14} />
                {item.assignments.length > 0 && <span>{item.assignments.length}</span>}
              </button>
            )}
            {canEditStructure && (
              <RowMenu>
                <RowMenuItem onSelect={handleAddSubitem}>
                  <span className="flex items-center gap-2">
                    <Plus size={14} /> 新增子項目
                  </span>
                </RowMenuItem>
                <RowMenuItem onSelect={() => handleInsert("before")}>
                  <span className="flex items-center gap-2">
                    <ArrowUpToLine size={14} /> 上方插入項目
                  </span>
                </RowMenuItem>
                <RowMenuItem onSelect={() => handleInsert("after")}>
                  <span className="flex items-center gap-2">
                    <ArrowDownToLine size={14} /> 下方插入項目
                  </span>
                </RowMenuItem>
                {canDeleteItem && (
                  <RowMenuItem danger onSelect={() => requestDelete(boardId, item.id)}>
                    <span className="flex items-center gap-2">
                      <Trash2 size={14} /> 刪除
                    </span>
                  </RowMenuItem>
                )}
              </RowMenu>
            )}
          </div>
        </div>
        <ItemDetailModal
          boardId={boardId}
          item={detailOpen ? item : null}
          columns={columns}
          users={users}
          progressColumnId={progressColumnId}
          ganttStartColumnId={ganttStartColumnId}
          ganttDurationColumnId={ganttDurationColumnId}
          ganttEndColumnId={ganttEndColumnId}
          predColumnId={predColumnId}
          linkColumnId={linkColumnId}
          predLamp={predLamps?.get(item.id)}
          groupItems={allGroupItems}
          lockedScheduleFields={lockedScheduleFields}
          manualScheduleHint={manualScheduleHint}
          userRole={userRole}
          currentUserId={currentUserId}
          open={detailOpen}
          onOpenChange={setDetailOpen}
          initialTab={detailTab}
        />
        <ItemDetailModal
          boardId={boardId}
          item={live(newChildItem)}
          columns={columns}
          users={users}
          progressColumnId={progressColumnId}
          ganttStartColumnId={ganttStartColumnId}
          ganttDurationColumnId={ganttDurationColumnId}
          ganttEndColumnId={ganttEndColumnId}
          predColumnId={predColumnId}
          linkColumnId={linkColumnId}
          predLamp={predLamps?.get(item.id)}
          groupItems={allGroupItems}
          lockedScheduleFields={lockedScheduleFields}
          manualScheduleHint={manualScheduleHint}
          userRole={userRole}
          currentUserId={currentUserId}
          open={newChildItem !== null}
          onOpenChange={(open) => !open && setNewChildItem(null)}
          initialTab="card"
        />
        <ItemDetailModal
          boardId={boardId}
          item={live(insertedItem)}
          columns={columns}
          users={users}
          progressColumnId={progressColumnId}
          ganttStartColumnId={ganttStartColumnId}
          ganttDurationColumnId={ganttDurationColumnId}
          ganttEndColumnId={ganttEndColumnId}
          predColumnId={predColumnId}
          linkColumnId={linkColumnId}
          predLamp={predLamps?.get(item.id)}
          groupItems={allGroupItems}
          lockedScheduleFields={lockedScheduleFields}
          manualScheduleHint={manualScheduleHint}
          userRole={userRole}
          currentUserId={currentUserId}
          open={insertedItem !== null}
          onOpenChange={(open) => !open && setInsertedItem(null)}
          initialTab="card"
        />
        {canEditStructure && (
          <AssignmentModal
            boardId={boardId}
            item={assignOpen ? item : null}
            users={users}
            currentUserId={currentUserId}
            userRole={userRole}
            open={assignOpen}
            onOpenChange={setAssignOpen}
          />
        )}
        {childRows}
      </>
    );
  }

  return (
    <>
      <div
        ref={rowRef}
        className="group grid h-9 w-fit items-center border-b border-neutral-100 dark:border-neutral-700 hover:bg-neutral-50 dark:hover:bg-neutral-800"
        style={{
          gridTemplateColumns: gridTemplate(columns.length),
          backgroundColor: rowBackground,
          transition: "background-color 1.5s ease",
        }}
      >
        {columns.map((col) => {
          const isScheduleColumn =
            col.id === ganttStartColumnId ||
            col.id === ganttDurationColumnId ||
            col.id === ganttEndColumnId;
          const lock = lockedScheduleFields.get(item.id);
          const isLockedField =
            (col.id === ganttStartColumnId && lock?.startLocked) ||
            (col.id === ganttEndColumnId && lock?.endLocked) ||
            (col.id === ganttDurationColumnId && lock?.daysLocked);
          const cellCanEdit =
            canEditCellValue(
              userRole,
              col.type,
              col.id === progressColumnId,
              isAssignedToCurrentUser,
              isAssignedToGroupDiscipline
            ) &&
            (!isScheduleColumn || canModifySchedule) &&
            !isLockedField;
          // Explains why a schedule cell can't be edited — shown as a prompt
          // the moment the user clicks it, not just a hover-only tooltip,
          // matching the Gantt bar's blockedReason pattern.
          const scheduleBlockedReason =
            isScheduleColumn && !cellCanEdit
              ? !canModifySchedule
                ? "權限不足:僅建立者或管理者可以修改此項目的時程"
                : isLockedField
                  ? (manualScheduleHint ??
                    "此日期由前置依賴、子項目統計或里程碑規則自動計算,請改天數、前置依賴或子項目設定")
                  : null
              : null;
          return (
            <div
              key={col.id}
              className={`border-r border-neutral-100 dark:border-neutral-700 px-1 ${scheduleBlockedReason ? "cursor-not-allowed" : ""}`}
              style={isLockedField ? { backgroundColor: "#f3f4f6" } : undefined}
              title={isLockedField ? (manualScheduleHint ?? "由前置依賴或子項目統計自動計算") : undefined}
              onClick={scheduleBlockedReason ? () => notify(scheduleBlockedReason) : undefined}
            >
              {col.id === predColumnId && predLamps?.get(item.id) ? (
                <span className="flex min-w-0 items-center gap-1.5">
                  <PredLampDot lamp={predLamps.get(item.id)} />
                  <span className="min-w-0 flex-1">
                    <CellEditor
                      boardId={boardId}
                      itemId={item.id}
                      column={col}
                      value={valuesByColumn.get(col.id) ?? null}
                      users={users}
                      canEdit={cellCanEdit}
                      predColumnId={predColumnId}
                      groupItems={allGroupItems}
                      wbsCodes={wbsCodes}
                      isProgressColumn={col.id === progressColumnId}
                    />
                  </span>
                </span>
              ) : hasChildren && col.id === progressColumnId ? (
                <RollupProgress
                  value={computeItemProgress(item, allGroupItems, col.id)}
                  childCount={children.length}
                />
              ) : (
                <CellEditor
                  boardId={boardId}
                  itemId={item.id}
                  column={col}
                  value={valuesByColumn.get(col.id) ?? null}
                  users={users}
                  canEdit={cellCanEdit}
                  predColumnId={predColumnId}
                  groupItems={allGroupItems}
                  wbsCodes={wbsCodes}
                  isProgressColumn={col.id === progressColumnId}
                />
              )}
            </div>
          );
        })}
      </div>
      {childRows}
    </>
  );
}

function RollupProgress({
  value,
  childCount,
}: {
  value: number | null;
  childCount: number;
}) {
  if (value === null) {
    return <span className="px-2 text-xs text-neutral-400 dark:text-neutral-500">—</span>;
  }
  const pct = Math.max(0, Math.min(1, value)) * 100;
  return (
    <div
      className="flex items-center gap-2 px-2"
      title={`依 ${childCount} 個子項目自動計算`}
    >
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-700">
        <div
          className="h-full rounded-full bg-blue-500"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="shrink-0 text-xs text-neutral-500 dark:text-neutral-400">
        {Math.round(pct)}%
      </span>
    </div>
  );
}
