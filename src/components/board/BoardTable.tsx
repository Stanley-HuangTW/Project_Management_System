"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  horizontalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Plus, Search, Target, Trash2 } from "lucide-react";
import type { BoardWithData, ColumnData, ItemData, UserOption } from "@/types/board";
import type { Holiday, UserRole } from "@prisma/client";
import { canManageStructure } from "@/lib/permissions";
import { computeVisibleItemIds, type ActiveFilter } from "@/lib/filter";
import { computeAncestorIds } from "@/lib/wbs";
import { resolveLockedScheduleFields } from "@/lib/predecessorLink";
import { computeRolledUpDateRange } from "@/lib/gantt";
import { resolveItemNameColor, resolveStatusColumn } from "@/lib/dashboard";
import { GroupSection } from "./GroupSection";
import { FilterBar } from "./FilterBar";
import { ItemDetailModal } from "./ItemDetailModal";
import { RowMenu, RowMenuItem } from "@/components/ui/RowMenu";
import {
  gridTemplate,
  frozenPaneWidth,
  DEFAULT_NAME_COLUMN_WIDTH,
  MIN_NAME_COLUMN_WIDTH,
  MAX_NAME_COLUMN_WIDTH,
  AUTO_FIT_MAX_NAME_COLUMN_WIDTH,
} from "./gridTemplate";
import { createGroup, reorderGroups } from "@/lib/actions/group";
import { deleteColumn, setProgressColumn, reorderColumns } from "@/lib/actions/column";

const NAME_CELL_CHROME_WIDTH = 132; // input padding + 留言/指派/更多操作 icons + gaps + measurement margin

function SortableColumnHeader({
  col,
  canEditStructure,
  isProgressColumn,
  onSetProgressColumn,
  onDelete,
}: {
  col: ColumnData;
  canEditStructure: boolean;
  isProgressColumn: boolean;
  onSetProgressColumn: () => void;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: col.id,
    disabled: !canEditStructure,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center justify-between border-r border-neutral-200 dark:border-neutral-700 px-1"
    >
      <span className="flex min-w-0 items-center gap-1">
        {canEditStructure && (
          <button
            type="button"
            {...attributes}
            {...listeners}
            className="shrink-0 cursor-grab text-neutral-300 dark:text-neutral-600 hover:text-neutral-500 dark:hover:text-neutral-400"
          >
            <GripVertical size={12} />
          </button>
        )}
        <span className="truncate">{col.name}</span>
      </span>
      {canEditStructure && (
        <RowMenu>
          {col.type === "NUMBER" && (
            <RowMenuItem onSelect={onSetProgressColumn}>
              <span className="flex items-center gap-2">
                <Target size={14} />
                {isProgressColumn ? "取消進度欄位" : "設為進度欄位"}
              </span>
            </RowMenuItem>
          )}
          <RowMenuItem danger onSelect={onDelete}>
            <span className="flex items-center gap-2">
              <Trash2 size={14} /> 刪除欄位
            </span>
          </RowMenuItem>
        </RowMenu>
      )}
    </div>
  );
}

/** Every item id that's somebody's parent — i.e. every row a "collapse all"
 *  should hide the children of. */
function allParentIds(items: ItemData[]): Set<string> {
  const parentIds = new Set<string>();
  for (const item of items) {
    if (item.parentId) parentIds.add(item.parentId);
  }
  return parentIds;
}

export function BoardTable({
  board,
  users,
  userRole,
  currentUserId,
  onAddColumn,
  highlightItemId,
  holidays,
}: {
  board: BoardWithData;
  users: UserOption[];
  userRole: UserRole;
  currentUserId: string;
  onAddColumn: () => void;
  highlightItemId?: string | null;
  holidays: Holiday[];
}) {
  const canEditStructure = canManageStructure(userRole);
  const router = useRouter();
  const [prevBoard, setPrevBoard] = useState(board);
  const [groupOrder, setGroupOrder] = useState(() => board.groups.map((g) => g.id));
  const [columnOrder, setColumnOrder] = useState(() => board.columns.map((c) => c.id));
  // groupOrder/columnOrder are locally-reorderable copies of the board's own
  // lists — but a plain useState initializer only runs on first mount, so a
  // group/column added after a revalidated refresh (new `board` prop) would
  // never appear without this resync, even though the data arrived correctly.
  if (board !== prevBoard) {
    setPrevBoard(board);
    setGroupOrder(board.groups.map((g) => g.id));
    setColumnOrder(board.columns.map((c) => c.id));
  }
  const [filters, setFilters] = useState<ActiveFilter[]>([]);
  const [groupFilterId, setGroupFilterId] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [nameWidth, setNameWidth] = useState(DEFAULT_NAME_COLUMN_WIDTH);
  // Starting fully expanded meant every render — including the very first,
  // server-rendered one — walked and rendered every item on the board, no
  // matter how deep. Collapsing anything with children by default (the
  // highlight-driven auto-expand below still opens the right ancestor
  // chain when needed) means a board's initial render cost tracks its
  // top-level item count, not its total item count.
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(() => allParentIds(board.items));
  const hasAutoSizedRef = useRef(false);
  const scrollPanesRef = useRef<Map<string, HTMLDivElement>>(new Map());

  function expandGroup(groupItems: ItemData[]) {
    const ids = allParentIds(groupItems);
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      for (const id of ids) next.delete(id);
      return next;
    });
  }

  function collapseGroup(groupItems: ItemData[]) {
    const ids = allParentIds(groupItems);
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      for (const id of ids) next.add(id);
      return next;
    });
  }

  function toggleCollapse(itemId: string) {
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  }

  function registerScrollPane(key: string, el: HTMLDivElement | null) {
    if (el) scrollPanesRef.current.set(key, el);
    else scrollPanesRef.current.delete(key);
  }

  // The frozen name column and the data columns are two separate, independently
  // scrolling panes (see the two-pane layout below) — position:sticky can't hide
  // scrolled-past content from a sibling column, only paint over what's directly
  // beneath it, so a wide table with many columns eventually shows other columns'
  // cells peeking out past the "frozen" column instead of staying hidden behind it.
  // Keeping the header's and every group's data pane in one real, separately
  // clipped scroll container (synced here) avoids that entirely.
  function handlePaneScroll(sourceKey: string) {
    const source = scrollPanesRef.current.get(sourceKey);
    if (!source) return;
    const left = source.scrollLeft;
    for (const [key, el] of scrollPanesRef.current) {
      if (key !== sourceKey && el.scrollLeft !== left) el.scrollLeft = left;
    }
  }
  const visibleIds = useMemo(
    () => computeVisibleItemIds(board.items, filters, searchQuery),
    [board.items, filters, searchQuery]
  );
  const expandIds = useMemo(
    () => computeAncestorIds(board.items, highlightItemId),
    [board.items, highlightItemId]
  );
  // When the board computes Start/Days/Finish from manual columns, a locked
  // cell has a concrete answer to "then what do I change?" — name those two
  // columns rather than leaving the generic "it's calculated" message.
  const manualScheduleHint = useMemo(() => {
    if (!board.manualStartColumnId || !board.manualDurationColumnId) return undefined;
    const name = (id: string) => board.columns.find((c) => c.id === id)?.name;
    const start = name(board.manualStartColumnId);
    const duration = name(board.manualDurationColumnId);
    if (!start || !duration) return undefined;
    return `此日期/天數由「${start}」與「${duration}」加上前置依賴自動計算,請改這兩個欄位`;
  }, [board.columns, board.manualStartColumnId, board.manualDurationColumnId]);

  // Task-name color by status — same rule and board-configured colors as
  // the Gantt view (BoardGantt.tsx's ganttStatusColor), via the shared
  // resolveItemNameColor helper.
  const nameColors = useMemo(() => {
    const map = new Map<string, string>();
    if (!board.ganttStartColumnId || !board.ganttDurationColumnId) return map;
    const statusColumn = resolveStatusColumn(board);
    const holidaySet = new Set(holidays.map((h) => h.date));
    for (const item of board.items) {
      const range = computeRolledUpDateRange(
        item,
        board.items,
        board.ganttStartColumnId,
        board.ganttDurationColumnId,
        board.ganttDurationMode,
        holidaySet,
        { predColumnId: board.predColumnId, manualStartColumnId: board.manualStartColumnId }
      );
      const color = resolveItemNameColor(item, board, statusColumn, range);
      if (color) map.set(item.id, color);
    }
    return map;
  }, [board, holidays]);
  // Clicking a notification (or any other ?highlight= link) should open that
  // item's card directly, not just scroll the row into view — re-arms on
  // every new highlightItemId so a second, different notification click
  // reopens it even if the user already closed the modal from the first one.
  // "Adjust state during render" (not an effect) so it fires exactly once
  // per prop change, same pattern as ItemDetailModal's own tab reset.
  const [autoOpenItemId, setAutoOpenItemId] = useState<string | null>(highlightItemId ?? null);
  const [prevHighlightItemId, setPrevHighlightItemId] = useState(highlightItemId);
  if (highlightItemId !== prevHighlightItemId) {
    setPrevHighlightItemId(highlightItemId);
    if (highlightItemId) setAutoOpenItemId(highlightItemId);
  }
  const autoOpenItem = autoOpenItemId ? (board.items.find((i) => i.id === autoOpenItemId) ?? null) : null;
  const lockedScheduleFields = useMemo(() => {
    const linkColumn = board.columns.find((c) => c.id === board.linkColumnId);
    const typeColumn = board.columns.find((c) => c.id === board.typeColumnId);
    return resolveLockedScheduleFields(
      board.items,
      board.predColumnId,
      board.linkColumnId,
      linkColumn?.options,
      board.typeColumnId,
      typeColumn?.options,
      board.manualStartColumnId,
      board.manualDurationColumnId
    );
  }, [
    board.items,
    board.columns,
    board.predColumnId,
    board.linkColumnId,
    board.typeColumnId,
    board.manualStartColumnId,
    board.manualDurationColumnId,
  ]);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  const groupsById = new Map(board.groups.map((g) => [g.id, g]));
  const columnsById = new Map(board.columns.map((c) => [c.id, c]));
  const orderedColumns = columnOrder
    .map((id) => columnsById.get(id))
    .filter((c): c is ColumnData => c !== undefined);
  const itemsByGroup = new Map<string, ItemData[]>();
  for (const item of board.items) {
    const list = itemsByGroup.get(item.groupId) ?? [];
    list.push(item);
    itemsByGroup.set(item.groupId, list);
  }

  useEffect(() => {
    if (hasAutoSizedRef.current) return;
    const timer = setTimeout(() => {
      if (hasAutoSizedRef.current) return;
      hasAutoSizedRef.current = true;
      const ctx = document.createElement("canvas").getContext("2d");
      if (!ctx) return;
      ctx.font = "14px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
      const itemsById = new Map(board.items.map((i) => [i.id, i]));
      let maxWidth = 0;
      for (const item of board.items) {
        let depth = 0;
        let current = item;
        while (current.parentId) {
          const parent = itemsById.get(current.parentId);
          if (!parent) break;
          depth++;
          current = parent;
        }
        const width = ctx.measureText(item.name).width + depth * 20 + NAME_CELL_CHROME_WIDTH;
        if (width > maxWidth) maxWidth = width;
      }
      if (maxWidth > 0) {
        setNameWidth(
          Math.min(AUTO_FIT_MAX_NAME_COLUMN_WIDTH, Math.max(DEFAULT_NAME_COLUMN_WIDTH, Math.ceil(maxWidth)))
        );
      }
    }, 0);
    return () => clearTimeout(timer);
  }, [board.items]);

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setGroupOrder((ids) => {
      const oldIndex = ids.indexOf(String(active.id));
      const newIndex = ids.indexOf(String(over.id));
      const next = arrayMove(ids, oldIndex, newIndex);
      reorderGroups(board.id, next);
      return next;
    });
  }

  function handleColumnDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setColumnOrder((ids) => {
      const oldIndex = ids.indexOf(String(active.id));
      const newIndex = ids.indexOf(String(over.id));
      const next = arrayMove(ids, oldIndex, newIndex);
      reorderColumns(board.id, next);
      return next;
    });
  }

  async function handleAddGroup() {
    const group = await createGroup(board.id, "新分組");
    // revalidatePath alone doesn't reliably refresh an already-open client
    // on a large board — force it so the new group actually renders.
    router.refresh();
    // The board can be long (many groups/items above), so a new group
    // appended at the bottom is easy to miss without this — it looked like
    // the button "did nothing" even though it worked every time. The new
    // group's DOM node appears only after the refresh above re-renders,
    // which can take a render past this point, so poll briefly rather
    // than assume one frame.
    let attempts = 0;
    const tryScroll = () => {
      const el = document.querySelector<HTMLElement>(`[data-group-id="${group.id}"]`);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        el.querySelector("input")?.focus();
      } else if (attempts++ < 20) {
        setTimeout(tryScroll, 100);
      }
    };
    tryScroll();
  }

  function startNameColumnResize(e: React.PointerEvent) {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = nameWidth;
    function onMove(ev: PointerEvent) {
      const next = startWidth + (ev.clientX - startX);
      setNameWidth(Math.min(MAX_NAME_COLUMN_WIDTH, Math.max(MIN_NAME_COLUMN_WIDTH, next)));
    }
    function onUp() {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  return (
    <div className="flex h-full flex-col">
      <div className="mb-2 flex items-center gap-2 text-sm">
        <span className="text-neutral-500 dark:text-neutral-400">專案(分組)</span>
        <select
          value={groupFilterId}
          onChange={(e) => setGroupFilterId(e.target.value)}
          className="rounded-md border border-neutral-300 dark:border-neutral-600 dark:bg-neutral-900 px-2 py-1 text-xs outline-none focus:border-blue-500"
        >
          <option value="">全部</option>
          {board.groups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
        {groupFilterId && (
          <button
            type="button"
            onClick={() => setGroupFilterId("")}
            className="text-xs text-neutral-400 dark:text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-100"
          >
            清除
          </button>
        )}
        <div className="relative ml-2">
          <Search size={13} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-neutral-400 dark:text-neutral-500" />
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="搜尋項目名稱..."
            className="w-48 rounded-md border border-neutral-300 dark:border-neutral-600 dark:bg-neutral-900 py-1 pl-7 pr-2 text-xs outline-none focus:border-blue-500"
          />
        </div>
      </div>
      <FilterBar columns={orderedColumns} users={users} filters={filters} onChange={setFilters} />

      <div className="flex flex-1 flex-col overflow-hidden rounded-lg border-2 border-neutral-800">
      <div className="flex shrink-0 items-center border-b border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800 text-xs font-medium text-neutral-500 dark:text-neutral-400">
        <div
          className="relative shrink-0 border-r border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800 px-2"
          style={{ width: frozenPaneWidth(nameWidth) }}
        >
          項目名稱
          <div
            onPointerDown={startNameColumnResize}
            className="absolute right-0 top-0 z-20 h-full w-1 cursor-col-resize hover:bg-blue-400"
          />
        </div>
        <DndContext
          id="board-columns-dnd"
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleColumnDragEnd}
        >
          <div
            ref={(el) => registerScrollPane("header", el)}
            onScroll={() => handlePaneScroll("header")}
            className="min-w-0 flex-1 overflow-x-auto"
          >
            <div
              className="grid w-fit items-center"
              style={{ gridTemplateColumns: gridTemplate(orderedColumns.length) }}
            >
              <SortableContext items={columnOrder} strategy={horizontalListSortingStrategy}>
                {orderedColumns.map((col) => (
                  <SortableColumnHeader
                    key={col.id}
                    col={col}
                    canEditStructure={canEditStructure}
                    isProgressColumn={board.progressColumnId === col.id}
                    onSetProgressColumn={() =>
                      setProgressColumn(board.id, board.progressColumnId === col.id ? null : col.id)
                    }
                    onDelete={() => deleteColumn(board.id, col.id)}
                  />
                ))}
              </SortableContext>
              {canEditStructure && (
                <button
                  type="button"
                  onClick={onAddColumn}
                  className="flex items-center justify-center text-neutral-400 dark:text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-100"
                  aria-label="新增欄位"
                >
                  <Plus size={16} />
                </button>
              )}
            </div>
          </div>
        </DndContext>
      </div>

      <div className="flex-1 overflow-y-auto p-2">
      <DndContext
        id="board-groups-dnd"
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext items={groupOrder} strategy={verticalListSortingStrategy}>
          <div className="space-y-4">
            {groupOrder.map((groupId) => {
              const group = groupsById.get(groupId);
              if (!group) return null;
              if (groupFilterId && groupId !== groupFilterId) return null;
              return (
                <GroupSection
                  key={group.id}
                  boardId={board.id}
                  group={group}
                  items={itemsByGroup.get(group.id) ?? []}
                  columns={orderedColumns}
                  users={users}
                  progressColumnId={board.progressColumnId}
                  ganttStartColumnId={board.ganttStartColumnId}
                  ganttDurationColumnId={board.ganttDurationColumnId}
                  ganttEndColumnId={board.ganttEndColumnId}
                  predColumnId={board.predColumnId}
                  lockedScheduleFields={lockedScheduleFields}
                  userRole={userRole}
                  currentUserId={currentUserId}
                  visibleIds={visibleIds}
                  nameWidth={nameWidth}
                  highlightItemId={highlightItemId}
                  expandIds={expandIds}
                  levelColors={board.levelColors}
                  nameColors={nameColors}
                  manualScheduleHint={manualScheduleHint}
                  collapsedIds={collapsedIds}
                  onToggleCollapse={toggleCollapse}
                  onExpandGroup={() => expandGroup(itemsByGroup.get(group.id) ?? [])}
                  onCollapseGroup={() => collapseGroup(itemsByGroup.get(group.id) ?? [])}
                  registerScrollPane={registerScrollPane}
                  onPaneScroll={handlePaneScroll}
                />
              );
            })}
          </div>
        </SortableContext>
      </DndContext>

      {canEditStructure && (
        <button
          type="button"
          onClick={handleAddGroup}
          className="mt-4 flex items-center gap-1 text-sm text-neutral-500 dark:text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-100"
        >
          <Plus size={14} /> 新增分組
        </button>
      )}
      </div>
      </div>

      <ItemDetailModal
        boardId={board.id}
        item={autoOpenItem}
        columns={orderedColumns}
        users={users}
        progressColumnId={board.progressColumnId}
        ganttStartColumnId={board.ganttStartColumnId}
        ganttDurationColumnId={board.ganttDurationColumnId}
        ganttEndColumnId={board.ganttEndColumnId}
        predColumnId={board.predColumnId}
        groupItems={autoOpenItem ? board.items.filter((i) => i.groupId === autoOpenItem.groupId) : undefined}
        lockedScheduleFields={lockedScheduleFields}
        userRole={userRole}
        currentUserId={currentUserId}
        open={autoOpenItem !== null}
        onOpenChange={(open) => !open && setAutoOpenItemId(null)}
        initialTab="updates"
      />
    </div>
  );
}
