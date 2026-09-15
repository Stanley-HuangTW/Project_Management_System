"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  closestCorners,
  type DragEndEvent,
  type DragOverEvent,
} from "@dnd-kit/core";
import type { BoardWithData, ColumnData, ItemData, UserOption } from "@/types/board";
import type { Holiday, UserRole } from "@prisma/client";
import { getStatusOptions } from "@/types/column";
import { itemOwnerIds } from "@/lib/boardReport";
import { classifyItemStatus, resolveStatusColumn, type ItemStatusKind } from "@/lib/dashboard";
import { computeRolledUpDateRange } from "@/lib/gantt";
import { KanbanLane } from "./KanbanLane";
import { upsertCellValue } from "@/lib/actions/cell";
import { subordinateIds } from "@/lib/orgChart";

// 逾期 first, then 未處理, then 實作中, then 已完成 last — same status
// precedence as the Gantt/table/dashboard name-color rule, repurposed as a
// sort key so the most urgent cards in each lane surface at the top.
const STATUS_SORT_RANK: Record<ItemStatusKind, number> = {
  overdue: 0,
  notStarted: 1,
  inProgress: 2,
  done: 3,
};

function personColumnIdsOf(columns: ColumnData[]): string[] {
  return columns.filter((c) => c.type === "PERSON").map((c) => c.id);
}

const UNSET_LANE = "unset";

export function BoardKanban({
  board,
  statusColumns,
  columnId,
  onChangeColumn,
  users,
  userRole,
  currentUserId,
  holidays,
}: {
  board: BoardWithData;
  statusColumns: ColumnData[];
  columnId: string;
  onChangeColumn: (id: string) => void;
  users: UserOption[];
  userRole: UserRole;
  currentUserId: string;
  holidays: Holiday[];
}) {
  const column = statusColumns.find((c) => c.id === columnId) ?? statusColumns[0];
  const personColumnIds = personColumnIdsOf(board.columns);
  const statuses = useMemo(
    () => (column ? getStatusOptions(column.options) : []),
    [column]
  );

  const [items, setItems] = useState<ItemData[]>(board.items);
  const [syncedBoardItems, setSyncedBoardItems] = useState(board.items);
  if (board.items !== syncedBoardItems) {
    setSyncedBoardItems(board.items);
    setItems(board.items);
  }

  const isSupervisor = userRole === "SUPERVISOR";
  const isMember = userRole === "MEMBER";
  const teamIds = isSupervisor ? [...subordinateIds(users, currentUserId)] : null;
  const [scope, setScope] = useState<"team" | "all">(isSupervisor ? "team" : "all");
  // Members only ever see their own items — there's no "all" toggle for them,
  // unlike supervisors who can widen to the whole board.
  const effectiveTeamIds = isMember ? [currentUserId] : scope === "team" ? teamIds : null;
  const scopedItems = effectiveTeamIds
    ? items.filter((item) => itemOwnerIds(item, board).some((id) => effectiveTeamIds.includes(id)))
    : items;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  const scrollRef = useRef<HTMLDivElement>(null);
  const topScrollRef = useRef<HTMLDivElement>(null);
  const dragState = useRef<{ startX: number; startScrollLeft: number } | null>(null);
  const [isPanning, setIsPanning] = useState(false);
  const [contentWidth, setContentWidth] = useState(0);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const update = () => setContentWidth(el.scrollWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [scopedItems.length]);

  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if ((e.target as HTMLElement).closest("[data-kanban-card]")) return;
    const container = scrollRef.current;
    if (!container) return;
    dragState.current = { startX: e.clientX, startScrollLeft: container.scrollLeft };
    setIsPanning(true);
    container.setPointerCapture(e.pointerId);
  }

  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!dragState.current || !scrollRef.current) return;
    scrollRef.current.scrollLeft = dragState.current.startScrollLeft - (e.clientX - dragState.current.startX);
  }

  function handlePointerUp(e: React.PointerEvent<HTMLDivElement>) {
    dragState.current = null;
    setIsPanning(false);
    scrollRef.current?.releasePointerCapture(e.pointerId);
  }

  function syncFromTopScroll() {
    if (scrollRef.current && topScrollRef.current) {
      scrollRef.current.scrollLeft = topScrollRef.current.scrollLeft;
    }
  }

  function syncFromMainScroll() {
    if (scrollRef.current && topScrollRef.current) {
      topScrollRef.current.scrollLeft = scrollRef.current.scrollLeft;
    }
  }

  function laneIdForItem(item: ItemData): string {
    if (!column) return UNSET_LANE;
    const cv = item.cellValues.find((c) => c.columnId === column.id);
    const val = cv?.value;
    if (typeof val === "string" && statuses.some((s) => s.id === val)) return val;
    return UNSET_LANE;
  }

  const holidaySet = useMemo(() => new Set(holidays.map((h) => h.date)), [holidays]);
  const sortStatusColumn = useMemo(() => resolveStatusColumn(board), [board]);
  const rangesById = useMemo(() => {
    const map = new Map<string, { start: Date; end: Date } | null>();
    if (!board.ganttStartColumnId || !board.ganttDurationColumnId) return map;
    for (const item of scopedItems) {
      map.set(
        item.id,
        computeRolledUpDateRange(
          item,
          board.items,
          board.ganttStartColumnId,
          board.ganttDurationColumnId,
          board.ganttDurationMode,
          holidaySet,
          { predColumnId: board.predColumnId, manualStartColumnId: board.manualStartColumnId }
        )
      );
    }
    return map;
  }, [scopedItems, board, holidaySet]);

  const lanes = useMemo(() => {
    const map = new Map<string, ItemData[]>();
    map.set(UNSET_LANE, []);
    for (const s of statuses) map.set(s.id, []);
    for (const item of scopedItems) {
      const laneId = laneIdForItem(item);
      const list = map.get(laneId) ?? [];
      list.push(item);
      map.set(laneId, list);
    }
    // 逾期 first, then 未處理, 實作中, 已完成 last — see STATUS_SORT_RANK.
    for (const list of map.values()) {
      list.sort((a, b) => {
        const rankA = STATUS_SORT_RANK[classifyItemStatus(a, board, sortStatusColumn, rangesById.get(a.id) ?? null)];
        const rankB = STATUS_SORT_RANK[classifyItemStatus(b, board, sortStatusColumn, rangesById.get(b.id) ?? null)];
        return rankA - rankB;
      });
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopedItems, column, statuses, board, sortStatusColumn, rangesById]);

  function findLaneOfCard(cardId: string): string | undefined {
    for (const [laneId, laneItems] of lanes) {
      if (laneItems.some((i) => i.id === cardId)) return laneId;
    }
    return undefined;
  }

  function resolveOverLane(overId: string): string | undefined {
    if (overId === UNSET_LANE || statuses.some((s) => s.id === overId)) {
      return overId;
    }
    return findLaneOfCard(overId);
  }

  function moveItemLocally(activeId: string, targetLane: string) {
    if (!column) return;
    const newValue = targetLane === UNSET_LANE ? null : targetLane;
    setItems((prev) =>
      prev.map((item) => {
        if (item.id !== activeId) return item;
        const existingIndex = item.cellValues.findIndex(
          (cv) => cv.columnId === column.id
        );
        const newCellValues =
          existingIndex >= 0
            ? item.cellValues.map((cv, idx) =>
                idx === existingIndex ? { ...cv, value: newValue } : cv
              )
            : [
                ...item.cellValues,
                {
                  id: `local-${item.id}-${column.id}`,
                  itemId: item.id,
                  columnId: column.id,
                  value: newValue,
                },
              ];
        return { ...item, cellValues: newCellValues };
      })
    );
  }

  function handleDragOver(event: DragOverEvent) {
    const { active, over } = event;
    if (!over || !column) return;
    const activeId = String(active.id);
    const overLane = resolveOverLane(String(over.id));
    const activeLane = findLaneOfCard(activeId);
    if (!overLane || !activeLane || overLane === activeLane) return;
    moveItemLocally(activeId, overLane);
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || !column) return;
    const activeId = String(active.id);
    const overLane = resolveOverLane(String(over.id));
    if (!overLane) return;

    const finalValue = overLane === UNSET_LANE ? null : overLane;
    upsertCellValue(board.id, activeId, column.id, finalValue);
  }

  if (!column) {
    return (
      <p className="text-sm text-neutral-500 dark:text-neutral-400">
        看板檢視需要至少一個「狀態」欄位,請先新增一個狀態欄位。
      </p>
    );
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-sm text-neutral-500 dark:text-neutral-400">依欄位分組:</span>
          <select
            value={column.id}
            onChange={(e) => onChangeColumn(e.target.value)}
            className="rounded-md border border-neutral-300 dark:border-neutral-600 dark:bg-neutral-900 px-2 py-1 text-sm outline-none focus:border-blue-500"
          >
            {statusColumns.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        {isSupervisor && (
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
        )}
      </div>

      <div
        ref={topScrollRef}
        onScroll={syncFromTopScroll}
        className="mb-1 overflow-x-auto overflow-y-hidden"
        style={{ height: 14 }}
      >
        <div style={{ width: contentWidth, height: 1 }} />
      </div>

      <DndContext
        id="board-kanban-dnd"
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
      >
        <div
          ref={scrollRef}
          onScroll={syncFromMainScroll}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerUp}
          className={`flex gap-4 overflow-x-auto pb-4 ${isPanning ? "cursor-grabbing select-none" : "cursor-grab"}`}
        >
          <KanbanLane
            laneId={UNSET_LANE}
            label="未設定"
            color="#9aa0a6"
            items={lanes.get(UNSET_LANE) ?? []}
            userRole={userRole}
            currentUserId={currentUserId}
            personColumnIds={personColumnIds}
          />
          {statuses.map((s) => (
            <KanbanLane
              key={s.id}
              laneId={s.id}
              label={s.label}
              color={s.color}
              items={lanes.get(s.id) ?? []}
              userRole={userRole}
              currentUserId={currentUserId}
              personColumnIds={personColumnIds}
            />
          ))}
        </div>
      </DndContext>
    </div>
  );
}
