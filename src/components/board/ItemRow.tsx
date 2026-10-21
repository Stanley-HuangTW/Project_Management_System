"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import {
  ArrowDownToLine,
  ArrowUpToLine,
  ChevronDown,
  ChevronRight,
  History,
  IndentDecrease,
  IndentIncrease,
  Lock,
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
import { RollupProgress } from "./RollupProgress";
import { ItemDetailModal } from "./ItemDetailModal";
import { AssignmentModal } from "./AssignmentModal";
import { RowMenu, RowMenuItem } from "@/components/ui/RowMenu";
import { useDialogs } from "@/components/ui/DialogProvider";
import { isStaleBuildError, STALE_BUILD_MESSAGE } from "@/lib/staleBuild";
import { createItem, insertItem } from "@/lib/actions/item";
import { useDeleteItem } from "./useDeleteItem";
import { useChangeLevel, levelDirectionOfKey, type LevelDirection } from "./useChangeLevel";
import { LevelButtons } from "./LevelButtons";
import { computeItemProgress } from "@/lib/progress";
import type { ScheduleLock, RelationshipType } from "@/lib/predecessorLink";
import { pinnedScheduleReason } from "@/lib/constraints";
import type { PredLamp } from "@/lib/predLamp";
import { PredLampDot } from "./PredLampDot";
import { ConstraintBadge } from "./ConstraintBadge";
import { VisibilityModal } from "./VisibilityModal";
import { summarizePredEdges, describeEdgeOverrides } from "@/lib/predEdgeSummary";
import { getStatusOptions } from "@/types/column";
import { gridTemplate, frozenPaneWidth } from "./gridTemplate";
import { ItemEventCells } from "./ItemEventCells";
import { ItemProtoUnitCell } from "./ItemProtoUnitCell";
import { ItemEventLogModal } from "./ItemEventLogModal";
import { useItemEvents } from "./ItemEventsContext";
import type { ItemDetailTab } from "@/lib/itemEvents";
import { indentTarget, outdentTarget, type DragOverState } from "@/lib/dragReorder";
import { DropIndicator } from "./DropIndicator";

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
  lagColumnId,
  manualStartColumnId,
  manualDurationColumnId,
  lockedScheduleFields,
  userRole,
  currentUserId,
  visibleIds,
  nameWidth,
  wbsCodes,
  crossGroupPredOptions,
  highlightItemId,
  expandIds,
  levelColors,
  nameColors,
  predLamps,
  selectedIds,
  onToggleSelected,
  manualScheduleHint,
  collapsedIds,
  onToggleCollapse,
  hasGroupScheduleRole = false,
  hasGroupStructureRole = false,
  groupTeamUserIds,
  dragOverTarget,
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
  /** The rest of the schedule inputs, so the 指派 modal opened from the
   *  table shows the same 時程設定 section (and its 相關項目 list) the
   *  Gantt's does — the table is where most of the work actually happens. */
  lagColumnId?: string | null;
  manualStartColumnId?: string | null;
  manualDurationColumnId?: string | null;
  lockedScheduleFields: Map<string, ScheduleLock>;
  userRole: UserRole;
  currentUserId: string;
  visibleIds: Set<string> | null;
  nameWidth: number;
  wbsCodes?: Map<string, string>;
  /** Items in the board's other groups, offered by the Pred picker so a
   *  dependency can cross a group. */
  crossGroupPredOptions?: { id: string; code: string; name: string }[];
  highlightItemId?: string | null;
  expandIds?: Set<string>;
  levelColors?: string[];
  nameColors?: Map<string, string>;
  /** Per-item Pred lamp — see resolvePredLamps. */
  predLamps?: Map<string, PredLamp>;
  /** Rows ticked for a bulk edit; absent when selection is off. */
  selectedIds?: Set<string>;
  onToggleSelected?: (itemId: string, selected: boolean) => void;
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
  /** 目前拖曳中、懸停在哪一列/哪個放置區——由 GroupSection 的 DndContext 算出,
   *  往下傳給每一列判斷要不要畫 DropIndicator。 */
  dragOverTarget?: DragOverState | null;
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
  const [visibilityOpen, setVisibilityOpen] = useState(false);
  const [eventLogOpen, setEventLogOpen] = useState(false);
  const { notify } = useDialogs();
  const requestDelete = useDeleteItem();
  // 升階 / 降階:只有項目列(frozen pane)用得到;沒有結構權限的人也不會有這兩個動作。
  const changeLevel = useChangeLevel(boardId);
  const canLevel = pane === "frozen" && canEditStructure;
  const indent = useMemo(() => (canLevel ? indentTarget(allGroupItems, item.id) : null), [canLevel, allGroupItems, item.id]);
  const outdent = useMemo(() => (canLevel ? outdentTarget(allGroupItems, item.id) : null), [canLevel, allGroupItems, item.id]);
  const runLevel = (direction: LevelDirection, refocus = false) =>
    changeLevel(direction, { id: item.id, groupId }, allGroupItems, {
      expandParent: (parentId) => {
        if (collapsedIds.has(parentId)) onToggleCollapse(parentId);
      },
      refocus,
    });
  const [detailTab, setDetailTab] = useState<ItemDetailTab>("updates");
  // 資料欄那邊的「更新記錄」「完成時間」等儲存格點下去,是請這一列(左邊項目名稱那塊)開項目視窗、跳到指定分頁。
  // 在 render 當下處理,不放進 effect——跟這個檔案裡其他「對齊外部狀態」的寫法一樣。
  const itemEvents = useItemEvents();
  const [handledOpenNonce, setHandledOpenNonce] = useState(0);
  const openRequest = itemEvents?.openRequest;
  if (pane === "frozen" && openRequest && openRequest.itemId === item.id && openRequest.nonce !== handledOpenNonce) {
    setHandledOpenNonce(openRequest.nonce);
    setDetailTab(openRequest.tab);
    setDetailOpen(true);
  }
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

  // 拖曳重新排列/改階層——只有 frozen pane(名稱/WBS 那一側)需要,data pane
  // (純格子)不用。兩個 hook 都無條件呼叫以符合 hook 規則,用 disabled 關掉。
  const dragDisabled = pane !== "frozen" || !canEditStructure;
  const { attributes: dragAttributes, listeners: dragListeners, setNodeRef: setDragRef, isDragging } = useDraggable({
    id: item.id,
    data: { groupId },
    disabled: dragDisabled,
  });
  const { setNodeRef: setDropRef } = useDroppable({ id: item.id, data: { groupId } });
  const setRowRef = (node: HTMLDivElement | null) => {
    rowRef.current = node;
    setDragRef(node);
    setDropRef(node);
  };
  const isDropTarget = dragOverTarget?.id === item.id;
  // 拖曳途中,被拖的這一列顯示「放開後會變成的 WBS 編號」,讓人看得出會落在哪一階。
  const previewCode = dragOverTarget?.draggedId === item.id ? (dragOverTarget.preview?.newCode ?? null) : null;

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

  // This item's dependencies, each with whatever relationship and lag it
  // carries of its own — see summarizePredEdges.
  // 這個項目的 Link 欄現在寫的是什麼;空白就當 FS(新加的前置預設 FS)。
  const linkOptionId = linkColumnId ? valuesByColumn.get(linkColumnId) : undefined;
  const linkLabel = linkColumnId
    ? (getStatusOptions(columns.find((c) => c.id === linkColumnId)?.options).find((o) => o.id === linkOptionId)?.label as
        | RelationshipType
        | undefined)
    : undefined;
  const predEdges = predColumnId
    ? summarizePredEdges(
        valuesByColumn.get(predColumnId),
        allGroupItems.map((i) => ({ id: i.id, code: wbsCodes?.get(i.id) ?? "", name: i.name }))
      )
    : [];

  /** Shared by the two add paths: neither had any error handling, so a
   *  refused or failed create left the row looking frozen. */
  async function addRow<T>(work: () => Promise<T>, onDone: (created: T) => void) {
    try {
      onDone(await work());
    } catch (err) {
      await notify(
        isStaleBuildError(err) ? STALE_BUILD_MESSAGE : err instanceof Error ? err.message : "新增失敗",
        { title: isStaleBuildError(err) ? "需要重新整理" : "無法新增項目" }
      );
    }
  }

  async function handleAddSubitem() {
    if (collapsedIds.has(item.id)) onToggleCollapse(item.id);
    await addRow(() => createItem(boardId, groupId, "新子項目", item.id), setNewChildItem);
  }

  async function handleInsert(position: "before" | "after") {
    await addRow(
      () => insertItem(boardId, groupId, item.parentId, item.id, position),
      setInsertedItem
    );
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
          lagColumnId={lagColumnId}
          manualStartColumnId={manualStartColumnId}
          manualDurationColumnId={manualDurationColumnId}
          lockedScheduleFields={lockedScheduleFields}
          userRole={userRole}
          currentUserId={currentUserId}
          visibleIds={visibleIds}
          nameWidth={nameWidth}
          wbsCodes={wbsCodes}
          crossGroupPredOptions={crossGroupPredOptions}
          highlightItemId={highlightItemId}
          expandIds={expandIds}
          levelColors={levelColors}
          nameColors={nameColors}
          predLamps={predLamps}
          selectedIds={selectedIds}
          onToggleSelected={onToggleSelected}
          manualScheduleHint={manualScheduleHint}
          collapsedIds={collapsedIds}
          onToggleCollapse={onToggleCollapse}
          dragOverTarget={dragOverTarget}
        />
      ))
    : null;

  if (pane === "frozen") {
    return (
      <>
        <div
          ref={setRowRef}
          {...dragAttributes}
          onPointerDown={(e) => {
            // 點名稱/留言/指派/選單/勾選框還是原本的點擊行為,不會被拖曳搶走。
            if ((e.target as HTMLElement).closest("button, input")) return;
            dragListeners?.onPointerDown?.(e);
          }}
          className={`group relative flex h-9 items-center border-b border-neutral-100 dark:border-neutral-700 hover:bg-neutral-50 dark:hover:bg-neutral-800 ${
            dragDisabled ? "" : isDragging ? "cursor-grabbing" : "cursor-grab"
          }`}
          style={{
            width: frozenPaneWidth(nameWidth),
            backgroundColor: rowBackground,
            transition: "background-color 1.5s ease",
            opacity: isDragging ? 0.5 : 1,
          }}
        >
          {isDropTarget &&
            dragOverTarget &&
            (() => {
              // 跟 GroupSection 的 handleItemDragMove 同一套「勾選框+展開箭頭」
              // 固定寬度算法,視覺提示線才會跟縮排實際對齊。
              const rowLeftOffset = (onToggleSelected ? 24 : 0) + 32;
              const indentLevel = dragOverTarget.zone === "outdent" ? Math.max(0, depth - 1) : depth;
              return (
                <DropIndicator
                  zone={dragOverTarget.zone}
                  indentPx={rowLeftOffset + indentLevel * 20}
                  label={dragOverTarget.preview?.label}
                />
              );
            })()}
          {onToggleSelected && (
            <div className="flex h-8 w-6 shrink-0 items-center justify-center">
              <input
                type="checkbox"
                checked={selectedIds?.has(item.id) ?? false}
                onChange={(e) => onToggleSelected(item.id, e.target.checked)}
                aria-label={`選取「${item.name}」`}
                className="h-3.5 w-3.5 cursor-pointer accent-blue-600"
              />
            </div>
          )}
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
            {previewCode ? (
              <span className="shrink-0 rounded bg-blue-600 px-1 text-xs font-bold text-white">{previewCode}</span>
            ) : (
              wbsCodes?.get(item.id) && (
                <span className="shrink-0 text-xs font-bold text-black">{wbsCodes.get(item.id)}</span>
              )
            )}
            {item.visibility === "PRIVATE" && (
              <span
                title="私人:只有指定的人看得到"
                aria-label="私人項目"
                className="shrink-0 text-neutral-400 dark:text-neutral-500"
              >
                <Lock size={11} />
              </span>
            )}
            <ConstraintBadge item={item} />
            <button
              type="button"
              onClick={() => {
                setDetailTab("card");
                setDetailOpen(true);
              }}
              title="編輯此項目所有欄位"
              data-item-name-button={item.id}
              onKeyDown={(e) => {
                const direction = levelDirectionOfKey(e);
                if (!direction || !(direction === "indent" ? indent : outdent)) return;
                e.preventDefault();
                void runLevel(direction, true);
              }}
              style={nameColors?.get(item.id) ? { color: nameColors.get(item.id) } : undefined}
              className="min-w-0 flex-1 truncate rounded px-2 py-1.5 text-left text-sm outline-none hover:bg-neutral-100 dark:hover:bg-neutral-800 focus:bg-white dark:focus:bg-neutral-900 focus:ring-1 focus:ring-blue-400"
            >
              {item.name}
            </button>
            <LevelButtons
              canIndent={!!indent}
              canOutdent={!!outdent}
              onIndent={() => void runLevel("indent")}
              onOutdent={() => void runLevel("outdent")}
            />
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
            <button
              type="button"
              onClick={() => setEventLogOpen(true)}
              title="更新記錄:這個項目所有的更新與變化"
              className="flex shrink-0 items-center gap-0.5 rounded px-1 py-0.5 text-xs text-neutral-300 hover:bg-neutral-100 hover:text-neutral-600 dark:text-neutral-600 dark:hover:bg-neutral-800 dark:hover:text-neutral-400"
              aria-label="更新記錄"
            >
              <History size={14} />
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
                {outdent && (
                  <RowMenuItem onSelect={() => void runLevel("outdent")}>
                    <span className="flex items-center gap-2">
                      <IndentDecrease size={14} /> 升階
                    </span>
                  </RowMenuItem>
                )}
                {indent && (
                  <RowMenuItem onSelect={() => void runLevel("indent")}>
                    <span className="flex items-center gap-2">
                      <IndentIncrease size={14} /> 降階
                    </span>
                  </RowMenuItem>
                )}
                <RowMenuItem onSelect={() => setVisibilityOpen(true)}>
                  <span className="flex items-center gap-2">
                    <Lock size={14} /> 可見範圍
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
        <ItemEventLogModal
          itemId={item.id}
          itemName={item.name}
          open={eventLogOpen}
          onOpenChange={setEventLogOpen}
          onPick={(tab) => {
            setEventLogOpen(false);
            setDetailTab(tab);
            setDetailOpen(true);
          }}
        />
        <VisibilityModal
          target={visibilityOpen ? { kind: "item", id: item.id, name: item.name } : null}
          users={users}
          open={visibilityOpen}
          onOpenChange={setVisibilityOpen}
        />
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
          crossGroupPredOptions={crossGroupPredOptions}
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
          crossGroupPredOptions={crossGroupPredOptions}
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
          crossGroupPredOptions={crossGroupPredOptions}
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
            columns={columns}
            predColumnId={predColumnId}
            linkColumnId={linkColumnId}
            lagColumnId={lagColumnId}
            durationColumnId={manualDurationColumnId ?? ganttDurationColumnId}
            manualStartColumnId={manualStartColumnId}
            ganttStartColumnId={ganttStartColumnId}
            ganttEndColumnId={ganttEndColumnId}
            predLamp={predLamps?.get(item.id)}
            canEditSchedule={canModifySchedule}
            groupItems={allGroupItems}
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
          // 完成日被「必須完成於」釘住時,日期欄鎖住的原因是這條約束,不是前置依賴。
          const pinnedReason =
            col.id === ganttDurationColumnId
              ? null
              : pinnedScheduleReason({ type: item.constraintType, date: item.constraintDate });
          const scheduleBlockedReason =
            isScheduleColumn && !cellCanEdit
              ? !canModifySchedule
                ? "權限不足:僅建立者或管理者可以修改此項目的時程"
                : isLockedField
                  ? (pinnedReason ??
                    manualScheduleHint ??
                    "此日期由前置依賴、子項目統計或里程碑規則自動計算,請改天數、前置依賴或子項目設定")
                  : null
              : null;
          // A Link or Lag cell whose column value some dependency ignores:
          // the per-edge setting lives in the Pred cell, so without a mark
          // here the table shows a Lag that half the chain is not using.
          const overrideNote =
            col.id === linkColumnId
              ? describeEdgeOverrides(predEdges, "relationship", linkLabel ?? "FS")
              : col.id === lagColumnId
                ? describeEdgeOverrides(predEdges, "lag")
                : null;
          return (
            <div
              key={col.id}
              data-cell-item={item.id}
              data-cell-col={col.id}
              className={`border-r border-neutral-100 dark:border-neutral-700 px-1 ${scheduleBlockedReason ? "cursor-not-allowed" : ""}`}
              style={isLockedField ? { backgroundColor: "#f3f4f6" } : undefined}
              title={isLockedField ? (pinnedReason ?? manualScheduleHint ?? "由前置依賴或子項目統計自動計算") : undefined}
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
                      crossGroupPredOptions={crossGroupPredOptions}
                      isProgressColumn={col.id === progressColumnId}
                    />
                  </span>
                </span>
              ) : hasChildren && col.id === progressColumnId ? (
                <RollupProgress
                  value={computeItemProgress(item, allGroupItems, col.id)}
                  childCount={children.length}
                />
              ) : overrideNote ? (
                <span className="flex min-w-0 items-center gap-0.5">
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
                      crossGroupPredOptions={crossGroupPredOptions}
                      isProgressColumn={col.id === progressColumnId}
                    />
                  </span>
                  <span
                    title={overrideNote}
                    className="shrink-0 cursor-help text-xs font-bold text-amber-600 dark:text-amber-400"
                    aria-label={overrideNote}
                  >
                    *
                  </span>
                </span>
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
                  crossGroupPredOptions={crossGroupPredOptions}
                  isProgressColumn={col.id === progressColumnId}
                />
              )}
            </div>
          );
        })}
        <ItemProtoUnitCell
          itemId={item.id}
          canEdit={canEditCellValue(userRole, "STATUS", false, isAssignedToCurrentUser, isAssignedToGroupDiscipline)}
        />
        <ItemEventCells itemId={item.id} />
      </div>
      {childRows}
    </>
  );
}
