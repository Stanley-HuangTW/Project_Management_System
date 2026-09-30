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
import {
  classifyItemStatus,
  computeDashboardDueLists,
  resolveStatusColumn,
  type DashboardDueLists,
  type DueItemEntry,
  type ItemStatusKind,
} from "@/lib/dashboard";
import { computeRolledUpDateRange } from "@/lib/gantt";
import { computeWbsCodes } from "@/lib/wbs";
import { KanbanLane } from "./KanbanLane";
import { ItemDetailModal } from "./ItemDetailModal";
import { loadItemDetailContext, type ItemDetailContext } from "@/lib/actions/itemSchedule";
import { upsertCellValue } from "@/lib/actions/cell";
import { subordinateIds } from "@/lib/orgChart";
import { useDialogs } from "@/components/ui/DialogProvider";

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

// 「依欄位分組」下拉選單裡的特殊選項——不對應任何實際欄位,選了之後改成
// 依到期時間分成已逾期/本週完成/未來 7 天/未來 30 天四欄,取代原本依狀態
// 欄位分組的邏輯。
const DUE_MODE = "__due__";

const DUE_LANES: {
  key: keyof DashboardDueLists;
  label: string;
  color: string;
  dateClass: string;
}[] = [
  { key: "overdue", label: "已逾期", color: "#e2445c", dateClass: "text-red-600 dark:text-red-400" },
  { key: "completedThisWeek", label: "本週完成", color: "#00c875", dateClass: "text-green-600 dark:text-green-400" },
  { key: "upcoming7", label: "未來 7 天", color: "#579bfc", dateClass: "text-neutral-500 dark:text-neutral-400" },
  { key: "upcoming30", label: "未來 30 天", color: "#9aa0a6", dateClass: "text-neutral-500 dark:text-neutral-400" },
];

// One past the four due-time buckets above — everything else (done outside
// this week, no schedule, or due more than 30 days out).
const OTHER_BUCKET = 4;

function formatDueDate(date: Date) {
  return `${date.getUTCMonth() + 1}/${date.getUTCDate()}`;
}

function DueCard({
  entry,
  isOpening,
  onOpen,
  dateClass,
}: {
  entry: DueItemEntry;
  isOpening: boolean;
  onOpen: (itemId: string) => void;
  dateClass: string;
}) {
  return (
    <div
      data-kanban-card
      className="flex items-center justify-between gap-2 rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-3 py-2 text-sm shadow-sm"
    >
      <button
        type="button"
        disabled={isOpening}
        onClick={() => onOpen(entry.itemId)}
        title={entry.itemName}
        className="min-w-0 truncate text-left text-neutral-800 hover:text-blue-600 hover:underline disabled:opacity-60 dark:text-neutral-100"
      >
        {entry.wbsCode && (
          <span className="mr-1.5 text-xs tabular-nums text-neutral-400 dark:text-neutral-500">
            {entry.wbsCode}
          </span>
        )}
        {entry.itemName}
      </button>
      <span className={`shrink-0 text-xs ${dateClass}`}>{formatDueDate(entry.end)}</span>
    </div>
  );
}

function DueLane({
  label,
  color,
  entries,
  dateClass,
  openingItemId,
  onOpenItem,
}: {
  label: string;
  color: string;
  entries: DueItemEntry[];
  dateClass: string;
  openingItemId: string | null;
  onOpenItem: (itemId: string) => void;
}) {
  return (
    <div className="flex w-72 shrink-0 flex-col rounded-lg bg-neutral-100 dark:bg-neutral-800">
      <div
        className="flex items-center gap-2 rounded-t-lg px-3 py-2 text-sm font-medium text-white"
        style={{ backgroundColor: color }}
      >
        {label}
        <span className="ml-auto text-xs opacity-80">{entries.length}</span>
      </div>
      <div className="flex min-h-[60px] flex-col gap-2 p-2">
        {entries.length === 0 ? (
          <p className="px-1 py-2 text-xs text-neutral-400 dark:text-neutral-500">沒有項目</p>
        ) : (
          entries.map((entry) => (
            <DueCard
              key={entry.itemId}
              entry={entry}
              isOpening={openingItemId === entry.itemId}
              onOpen={onOpenItem}
              dateClass={dateClass}
            />
          ))
        )}
      </div>
    </div>
  );
}

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
  const isDueMode = columnId === DUE_MODE;
  const column = isDueMode ? undefined : statusColumns.find((c) => c.id === columnId) ?? statusColumns[0];
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
  const teamIds = useMemo(
    () => (isSupervisor ? [...subordinateIds(users, currentUserId)] : null),
    [isSupervisor, users, currentUserId]
  );
  const [scope, setScope] = useState<"team" | "all">(isSupervisor ? "team" : "all");
  // Members only ever see their own items — there's no "all" toggle for them,
  // unlike supervisors who can widen to the whole board.
  const effectiveTeamIds = useMemo(
    () => (isMember ? [currentUserId] : scope === "team" ? teamIds : null),
    [isMember, currentUserId, scope, teamIds]
  );
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
  // Always computed (not just in due mode) — the status-column lanes also use
  // this to divide each lane's cards into the same 已逾期/本週完成/未來 7
  // 天/未來 30 天 sections, so both views agree on the same classification.
  const dueLists = useMemo(
    () => computeDashboardDueLists([board], effectiveTeamIds ?? undefined, holidaySet),
    [board, effectiveTeamIds, holidaySet]
  );
  const dueBucketByItemId = useMemo(() => {
    const map = new Map<string, number>();
    [dueLists.overdue, dueLists.completedThisWeek, dueLists.upcoming7, dueLists.upcoming30].forEach(
      (list, bucket) => {
        for (const entry of list) map.set(entry.itemId, bucket);
      }
    );
    return map;
  }, [dueLists]);
  const wbsByItemId = useMemo(() => {
    const map = new Map<string, string>();
    for (const group of board.groups) {
      const groupItems = board.items.filter((i) => i.groupId === group.id);
      for (const [id, code] of computeWbsCodes(groupItems)) map.set(id, code);
    }
    return map;
  }, [board]);
  const { notify } = useDialogs();
  const [itemDetail, setItemDetail] = useState<ItemDetailContext | null>(null);
  const [openingDetailItemId, setOpeningDetailItemId] = useState<string | null>(null);

  async function openItemDetail(itemId: string) {
    setOpeningDetailItemId(itemId);
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
      setOpeningDetailItemId(null);
    }
  }

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
    // 已逾期/本週完成/未來 7 天/未來 30 天 first (in that order, by end date
    // within each), same classification as the due-time grouping — anything
    // outside those four windows falls into "其他", ordered the old way:
    // 逾期 first, then 未處理, 實作中, 已完成 last (STATUS_SORT_RANK).
    for (const list of map.values()) {
      list.sort((a, b) => {
        const bucketA = dueBucketByItemId.get(a.id) ?? OTHER_BUCKET;
        const bucketB = dueBucketByItemId.get(b.id) ?? OTHER_BUCKET;
        if (bucketA !== bucketB) return bucketA - bucketB;
        if (bucketA === OTHER_BUCKET) {
          const rankA = STATUS_SORT_RANK[classifyItemStatus(a, board, sortStatusColumn, rangesById.get(a.id) ?? null)];
          const rankB = STATUS_SORT_RANK[classifyItemStatus(b, board, sortStatusColumn, rangesById.get(b.id) ?? null)];
          return rankA - rankB;
        }
        const endA = rangesById.get(a.id)?.end.getTime() ?? 0;
        const endB = rangesById.get(b.id)?.end.getTime() ?? 0;
        return endA - endB;
      });
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopedItems, column, statuses, board, sortStatusColumn, rangesById, dueBucketByItemId]);

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

  if (!isDueMode && !column) {
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
            value={isDueMode ? DUE_MODE : column?.id ?? ""}
            onChange={(e) => onChangeColumn(e.target.value)}
            className="rounded-md border border-neutral-300 dark:border-neutral-600 dark:bg-neutral-900 px-2 py-1 text-sm outline-none focus:border-blue-500"
          >
            <option value={DUE_MODE}>到期時間</option>
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

      {isDueMode ? (
        <div
          ref={scrollRef}
          onScroll={syncFromMainScroll}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerUp}
          className={`flex gap-4 overflow-x-auto pb-4 ${isPanning ? "cursor-grabbing select-none" : "cursor-grab"}`}
        >
          {DUE_LANES.map((lane) => (
            <DueLane
              key={lane.key}
              label={lane.label}
              color={lane.color}
              dateClass={lane.dateClass}
              entries={dueLists[lane.key]}
              openingItemId={openingDetailItemId}
              onOpenItem={openItemDetail}
            />
          ))}
        </div>
      ) : (
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
              wbsByItemId={wbsByItemId}
              bucketByItemId={dueBucketByItemId}
              openingItemId={openingDetailItemId}
              onOpenDetail={openItemDetail}
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
                wbsByItemId={wbsByItemId}
                bucketByItemId={dueBucketByItemId}
                openingItemId={openingDetailItemId}
                onOpenDetail={openItemDetail}
              />
            ))}
          </div>
        </DndContext>
      )}

      <ItemDetailModal
        boardId={itemDetail?.boardId ?? ""}
        item={itemDetail?.item ?? null}
        columns={itemDetail?.columns ?? []}
        users={users}
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
      />
    </div>
  );
}
