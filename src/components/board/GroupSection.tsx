"use client";

import { useMemo, useRef, useState } from "react";
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragMoveEvent,
  type DragEndEvent,
} from "@dnd-kit/core";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ChevronDown, ChevronRight, ChevronsDown, ChevronsUp, GripVertical, Lock, Trash2 } from "lucide-react";
import type { GroupData, ColumnData, ItemData, UserOption } from "@/types/board";
import type { UserRole } from "@prisma/client";
import { canManageStructure, canManageGroupStructure } from "@/lib/permissions";
import { resolveGroupRoleAccess, groupDisciplineTeamUserIds } from "@/lib/groupRoles";
import { ItemRow } from "./ItemRow";
import { gridTemplate, frozenPaneWidth } from "./gridTemplate";
import { renameGroup, deleteGroup } from "@/lib/actions/group";
import { useDialogs } from "@/components/ui/DialogProvider";
import { isStaleBuildError, STALE_BUILD_MESSAGE } from "@/lib/staleBuild";
import { createItem } from "@/lib/actions/item";
import { useRecordedItemMove } from "./useRecordedItemMove";
import { VisibilityModal } from "./VisibilityModal";
import { RowMenu, RowMenuItem } from "@/components/ui/RowMenu";
import { computeWbsCodes, computeAncestorIds } from "@/lib/wbs";
import { classifyDropZone, previewDrop, type DragOverState } from "@/lib/dragReorder";
import type { ScheduleLock } from "@/lib/predecessorLink";
import type { PredLamp } from "@/lib/predLamp";

export function GroupSection({
  boardId,
  group,
  items,
  columns,
  users,
  progressColumnId,
  ganttStartColumnId,
  ganttDurationColumnId,
  ganttEndColumnId,
  predColumnId,
  linkColumnId,
  lagColumnId,
  otherGroups,
  manualStartColumnId,
  manualDurationColumnId,
  lockedScheduleFields,
  userRole,
  currentUserId,
  visibleIds,
  nameWidth,
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
  onExpandGroup,
  onCollapseGroup,
  registerScrollPane,
  onPaneScroll,
}: {
  boardId: string;
  group: GroupData;
  items: ItemData[];
  columns: ColumnData[];
  users: UserOption[];
  progressColumnId: string | null;
  ganttStartColumnId: string | null;
  ganttDurationColumnId: string | null;
  ganttEndColumnId: string | null;
  predColumnId?: string | null;
  /** For the item card's 相關項目 list — see listDependentItems. */
  linkColumnId?: string | null;
  lagColumnId?: string | null;
  /** The board's other groups, for the Pred picker — a dependency may now
   *  cross one. */
  otherGroups: { id: string; name: string; items: ItemData[] }[];
  manualStartColumnId?: string | null;
  manualDurationColumnId?: string | null;
  lockedScheduleFields: Map<string, ScheduleLock>;
  userRole: UserRole;
  currentUserId: string;
  visibleIds: Set<string> | null;
  nameWidth: number;
  highlightItemId?: string | null;
  expandIds?: Set<string>;
  levelColors?: string[];
  nameColors?: Map<string, string>;
  /** Per-item Pred lamp — see resolvePredLamps. */
  predLamps?: Map<string, PredLamp>;
  /** Rows ticked for a bulk edit; absent when selection is off. */
  selectedIds?: Set<string>;
  onToggleSelected?: (itemId: string, selected: boolean) => void;
  manualScheduleHint?: string;
  collapsedIds: Set<string>;
  onToggleCollapse: (itemId: string) => void;
  onExpandGroup: () => void;
  onCollapseGroup: () => void;
  registerScrollPane: (key: string, el: HTMLDivElement | null) => void;
  onPaneScroll: (key: string) => void;
}) {
  const wbsCodes = useMemo(() => computeWbsCodes(items), [items]);

  // Items in the board's OTHER groups, offered by the Pred picker so a
  // dependency can cross a group. Their WBS code is prefixed with the group
  // name: a code is a position within its own group's tree, so "1.2" means a
  // different task in each of them.
  const crossGroupPredOptions = useMemo(
    () =>
      otherGroups.flatMap((other) => {
        const codes = computeWbsCodes(other.items);
        return other.items
          .map((i) => ({
            id: i.id,
            code: `${other.name} · ${codes.get(i.id) ?? ""}`,
            name: i.name,
            wbsCode: codes.get(i.id) ?? "",
            parentId: i.parentId,
          }))
          .filter((o) => !o.code.endsWith(" · "));
      }),
    [otherGroups]
  );
  const canEditStructure = canManageStructure(userRole);
  const myGroupAccess = useMemo(
    () => resolveGroupRoleAccess(group.roleAssignments.filter((a) => a.userId === currentUserId)),
    [group.roleAssignments, currentUserId]
  );
  const groupTeamUserIds = useMemo(
    () => groupDisciplineTeamUserIds(group.members, myGroupAccess),
    [group.members, myGroupAccess]
  );
  const canCreateItems = canManageGroupStructure(userRole, myGroupAccess.disciplines.size > 0);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: group.id, disabled: !canEditStructure });
  const [collapsed, setCollapsed] = useState(false);
  const [name, setName] = useState(group.name);
  const [newItemName, setNewItemName] = useState("");
  const { notify } = useDialogs();
  const [visibilityOpen, setVisibilityOpen] = useState(false);
  const scrollPaneKey = `group:${group.id}`;

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  };

  function saveName() {
    if (name.trim() && name !== group.name) {
      renameGroup(boardId, group.id, name.trim());
    } else {
      setName(group.name);
    }
  }

  const [adding, setAdding] = useState(false);

  async function handleAddItem() {
    if (!newItemName.trim() || adding) return;
    setAdding(true);
    try {
      await createItem(boardId, group.id, newItemName.trim());
      // Cleared only on success — a failed add should leave what was typed,
      // not make the person retype it.
      setNewItemName("");
    } catch (err) {
      await notify(
        isStaleBuildError(err) ? STALE_BUILD_MESSAGE : err instanceof Error ? err.message : "新增失敗",
        { title: isStaleBuildError(err) ? "需要重新整理" : "無法新增項目" }
      );
    } finally {
      setAdding(false);
    }
  }

  // 拖曳重新排列/改階層——只套用在 frozen pane 的項目列,跟上面「拖 Group 標題」
  // 的 useSortable 是不同的 DndContext,彼此拖曳來源是不同的 DOM 節點,不會互搶。
  const itemDragSensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const [dragOverTarget, setDragOverTarget] = useState<DragOverState | null>(null);
  const dragActivatorRef = useRef<{ x: number; y: number } | null>(null);
  const moveRecorded = useRecordedItemMove();

  function handleItemDragStart(event: DragStartEvent) {
    const activator = event.activatorEvent as PointerEvent;
    dragActivatorRef.current = { x: activator.clientX, y: activator.clientY };
  }

  /** 兩邊(拖曳中的視覺提示、放開時實際執行)都要用同一套算法算出 zone——不能
   *  在 onDragMove 算一次存進 state,onDragEnd 再讀那個 state:React state 更新
   *  是非同步的,onDragEnd 緊接著 onDragMove 觸發時可能讀到還沒更新的舊值,放開
   *  當下判斷用的 zone 就會跟剛剛畫面上顯示的提示線不一致。兩邊都直接從自己收到
   *  的 event 重新算一次。 */
  function computeDropZone(
    over: { id: string | number; rect: { top: number; height: number; left: number } },
    delta: { x: number; y: number },
    activeId: string | number
  ): DragOverState | null {
    const activator = dragActivatorRef.current;
    // 懸停在自己身上(剛開始拖的時候)不是一個放置位置,不畫提示。
    if (!activator || over.id === activeId) return null;
    const targetItem = items.find((i) => i.id === over.id);
    if (!targetItem) return null;
    const depth = computeAncestorIds(items, targetItem.id).size;
    // pointerX 跟 targetIndentPx 要在同一個座標系——都換算成「離這一列左邊界多遠」,
    // 再加上勾選框(24px,只有開啟批次編輯時才有)+ 展開箭頭(32px)這段固定寬度,
    // 縮排的 paddingLeft 才是從這之後才開始算。
    const rowLeftOffset = (onToggleSelected ? 24 : 0) + 32;
    const zone = classifyDropZone({
      rowTop: over.rect.top,
      rowHeight: over.rect.height,
      pointerY: activator.y + delta.y,
      targetIndentPx: rowLeftOffset + depth * 20,
      pointerX: activator.x + delta.x - over.rect.left,
      indentUnitPx: 20,
      targetIsTopLevel: targetItem.parentId === null,
    });
    const draggedId = String(activeId);
    return { id: targetItem.id, zone, draggedId, preview: previewDrop(items, draggedId, targetItem.id, zone) };
  }

  function handleItemDragMove(event: DragMoveEvent) {
    const { active, over, delta } = event;
    const next = over ? computeDropZone(over, delta, active.id) : null;
    // 滑鼠每動一下都會進來——目標列、放置區、預覽都沒變就保留原本的 state,
    // 不要讓整棵項目樹跟著重畫。
    setDragOverTarget((prev) =>
      prev &&
      next &&
      prev.id === next.id &&
      prev.zone === next.zone &&
      prev.draggedId === next.draggedId &&
      prev.preview?.label === next.preview?.label
        ? prev
        : next
    );
  }

  async function handleItemDragEnd(event: DragEndEvent) {
    const { active, over, delta } = event;
    const result = over ? computeDropZone(over, delta, active.id) : null;
    const zone = result?.zone;
    setDragOverTarget(null);
    dragActivatorRef.current = null;
    if (!over || !zone || active.id === over.id) return;
    try {
      await moveRecorded({
        boardId,
        groupId: group.id,
        groupItems: items,
        draggedId: String(active.id),
        targetId: String(over.id),
        zone,
      });
    } catch (err) {
      await notify(
        isStaleBuildError(err) ? STALE_BUILD_MESSAGE : err instanceof Error ? err.message : "搬移失敗",
        { title: isStaleBuildError(err) ? "需要重新整理" : "無法搬移項目" }
      );
    }
  }

  function handleItemDragCancel() {
    setDragOverTarget(null);
    dragActivatorRef.current = null;
  }

  const topLevelItems = items
    .filter((item) => item.parentId === null)
    .filter((item) => visibleIds === null || visibleIds.has(item.id))
    .sort((a, b) => a.order - b.order);

  return (
    <div
      ref={setNodeRef}
      data-group-id={group.id}
      style={style}
      className="rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900"
    >
      <div
        className="flex items-center gap-2 border-b border-neutral-100 dark:border-neutral-700 px-2 py-2"
        style={{ borderLeft: `4px solid ${group.color}` }}
      >
        {canEditStructure && (
          <button
            type="button"
            {...attributes}
            {...listeners}
            className="cursor-grab text-neutral-300 dark:text-neutral-600 hover:text-neutral-500 dark:hover:text-neutral-400"
          >
            <GripVertical size={14} />
          </button>
        )}
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          className="text-neutral-500 dark:text-neutral-400"
        >
          {collapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
        </button>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={saveName}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur();
          }}
          readOnly={!canEditStructure}
          className="min-w-0 flex-1 rounded bg-transparent px-1 py-0.5 text-sm font-semibold text-neutral-800 dark:text-neutral-100 outline-none hover:bg-neutral-100 dark:hover:bg-neutral-800 focus:bg-white dark:focus:bg-neutral-900 focus:ring-1 focus:ring-blue-400"
        />
        <span className="text-xs text-neutral-400 dark:text-neutral-500">
          {visibleIds === null
            ? items.length
            : `${items.filter((i) => visibleIds.has(i.id)).length} / ${items.length}`}{" "}
          項目
        </span>
        <button
          type="button"
          onClick={onExpandGroup}
          title="展開此分組"
          className="text-neutral-400 dark:text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-100"
        >
          <ChevronsDown size={13} />
        </button>
        <button
          type="button"
          onClick={onCollapseGroup}
          title="收合此分組"
          className="text-neutral-400 dark:text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-100"
        >
          <ChevronsUp size={13} />
        </button>
        {canEditStructure && (
          <RowMenu>
            <RowMenuItem onSelect={() => setVisibilityOpen(true)}>
              <span className="flex items-center gap-2">
                <Lock size={14} /> 可見範圍
              </span>
            </RowMenuItem>
            <RowMenuItem danger onSelect={() => deleteGroup(boardId, group.id)}>
              <span className="flex items-center gap-2">
                <Trash2 size={14} /> 刪除分組
              </span>
            </RowMenuItem>
          </RowMenu>
        )}
      </div>

      {!collapsed && (
        <div className="flex items-start">
          <div className="shrink-0" style={{ width: frozenPaneWidth(nameWidth) }}>
            <DndContext
              id={`item-rows-dnd:${group.id}`}
              sensors={itemDragSensors}
              onDragStart={handleItemDragStart}
              onDragMove={handleItemDragMove}
              onDragEnd={handleItemDragEnd}
              onDragCancel={handleItemDragCancel}
            >
              {topLevelItems.map((item) => (
                <ItemRow
                  key={item.id}
                  pane="frozen"
                  boardId={boardId}
                  groupId={group.id}
                  item={item}
                  allGroupItems={items}
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
                  hasGroupScheduleRole={myGroupAccess.hasScheduleRole}
                  hasGroupStructureRole={myGroupAccess.disciplines.size > 0}
                  groupTeamUserIds={groupTeamUserIds}
                  dragOverTarget={dragOverTarget}
                />
              ))}
            </DndContext>
            {canCreateItems && (
              <div className="flex h-9 items-center">
                <input
                  value={newItemName}
                  onChange={(e) => setNewItemName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleAddItem()}
                  onBlur={handleAddItem}
                  placeholder="+ 新增項目"
                  className="ml-8 min-w-0 flex-1 rounded bg-white dark:bg-neutral-900 px-2 py-1 text-sm text-neutral-500 dark:text-neutral-400 outline-none hover:bg-neutral-50 dark:hover:bg-neutral-800 focus:bg-white dark:focus:bg-neutral-900 focus:text-neutral-900 dark:focus:text-neutral-100 focus:ring-1 focus:ring-blue-400"
                />
              </div>
            )}
          </div>
          <div
            ref={(el) => registerScrollPane(scrollPaneKey, el)}
            onScroll={() => onPaneScroll(scrollPaneKey)}
            className="no-scrollbar min-w-0 flex-1 overflow-x-auto"
          >
            {topLevelItems.map((item) => (
              <ItemRow
                key={item.id}
                pane="data"
                boardId={boardId}
                groupId={group.id}
                item={item}
                allGroupItems={items}
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
                hasGroupScheduleRole={myGroupAccess.hasScheduleRole}
                hasGroupStructureRole={myGroupAccess.disciplines.size > 0}
                groupTeamUserIds={groupTeamUserIds}
              />
            ))}
            {canCreateItems && (
              <div
                className="grid h-9 w-fit items-center"
                style={{ gridTemplateColumns: gridTemplate(columns.length) }}
              />
            )}
          </div>
        </div>
      )}

      <VisibilityModal
        target={visibilityOpen ? { kind: "group", id: group.id, name: group.name } : null}
        users={users}
        open={visibilityOpen}
        onOpenChange={setVisibilityOpen}
      />
    </div>
  );
}
