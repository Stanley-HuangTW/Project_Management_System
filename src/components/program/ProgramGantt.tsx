"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  Zap,
  Star,
  ArrowRightLeft,
  ChevronDown,
  ChevronRight,
  Maximize2,
  Minimize2,
} from "lucide-react";
import type { UserRole } from "@prisma/client";
import type { ProgramTask, ProgramView } from "@/lib/programView";
import type { UserOption } from "@/types/board";
import { buildDependencyArrows, type BarBox } from "@/lib/ganttArrows";
import type { RelationshipType } from "@/lib/predecessorLink";
import { loadItemDetailContext, type ItemDetailContext } from "@/lib/actions/itemSchedule";
import { ItemDetailModal } from "@/components/board/ItemDetailModal";
import { useDialogs } from "@/components/ui/DialogProvider";

type Zoom = "day" | "week" | "month";
const ZOOM_DAY_WIDTH: Record<Zoom, number> = { day: 28, week: 9, month: 3 };
const LABEL_WIDTH = 300;
const ROW_H = 28;
const BOARD_ROW_H = 30;
const GROUP_ROW_H = 24;
const DAY_MS = 86_400_000;

/** One hue per board, so a bar says which board it belongs to without being
 *  read. Deliberately not the assignee colors the board Gantt uses — here the
 *  question is "whose stage is this?", not "who is doing it?". */
const BOARD_COLORS = ["#579bfc", "#00c875", "#a25ddc", "#fdab3d", "#ff642e", "#037f4c"];

function toIso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function formatDay(date: Date): string {
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

function isWeekend(date: Date): boolean {
  const day = date.getUTCDay();
  return day === 0 || day === 6;
}

type Row =
  | { kind: "board"; boardId: string; boardName: string; taskCount: number; color: string }
  /** 分組標題。WBS 是項目在自己分組樹裡的位置,每個分組都從 1 重新開始,
   *  所以少了這一列,兩個分組的「1 POC Phase」看起來會像同一件事重複了。 */
  | { kind: "group"; boardId: string; groupId: string; groupName: string; taskCount: number }
  | { kind: "task"; task: ProgramTask; color: string };

/**
 * 群組甘特圖 — every board in a 專案群組 on one timeline.
 *
 * Read-only on purpose. Dragging a bar here would have to decide which
 * board's rules it was editing under, and the board's own Gantt already does
 * that properly; what this view adds is the thing no single board can show —
 * the dependency that leaves one board and lands in another, and a critical
 * path that runs through all of them.
 */
export function ProgramGantt({
  view,
  holidays,
  users,
  currentUserId,
  userRole,
}: {
  view: ProgramView;
  holidays: string[];
  users: UserOption[];
  currentUserId: string;
  userRole: UserRole;
}) {
  const [zoom, setZoom] = useState<Zoom>("week");
  const [showCritical, setShowCritical] = useState(true);
  const [showArrows, setShowArrows] = useState(true);
  const [onlyCritical, setOnlyCritical] = useState(false);
  /** 顯示比例。時間刻度換的是「一天多寬」,這個換的是整張圖多大 —— 兩個
   *  一起用才能在一個畫面裡塞進一整年又看得清楚。 */
  const [scalePct, setScalePct] = useState(100);
  const [boardFilterId, setBoardFilterId] = useState("");
  const [groupFilterId, setGroupFilterId] = useState("");
  const [isFullscreen, setIsFullscreen] = useState(false);
  const { notify } = useDialogs();
  const [itemDetail, setItemDetail] = useState<ItemDetailContext | null>(null);
  const [openingItemId, setOpeningItemId] = useState<string | null>(null);

  async function openItemDetail(itemId: string) {
    setOpeningItemId(itemId);
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
      setOpeningItemId(null);
    }
  }

  const holidaySet = useMemo(() => new Set(holidays), [holidays]);
  const dayWidth = ZOOM_DAY_WIDTH[zoom];

  const colorOfBoard = useMemo(() => {
    const map = new Map<string, string>();
    view.boards.forEach((board, i) => map.set(board.id, BOARD_COLORS[i % BOARD_COLORS.length]));
    return map;
  }, [view.boards]);

  // Calendar days, never business days: the boards in a group can be set to
  // different 計算方式, and a timeline that skipped some board's non-working
  // days would put every other board's bars in the wrong place.
  const days = useMemo(() => {
    if (!view.startDate || !view.finishDate) return [] as Date[];
    const start = new Date(`${view.startDate}T00:00:00.000Z`);
    const end = new Date(`${view.finishDate}T00:00:00.000Z`);
    const out: Date[] = [];
    for (let t = start.getTime() - 2 * DAY_MS; t <= end.getTime() + 2 * DAY_MS; t += DAY_MS) {
      out.push(new Date(t));
    }
    return out;
  }, [view.startDate, view.finishDate]);

  const dayIndexByIso = useMemo(() => {
    const map = new Map<string, number>();
    days.forEach((d, i) => map.set(toIso(d), i));
    return map;
  }, [days]);

  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  /** 誰有子項 —— 只有它們才需要收合的把手。 */
  const hasChildren = useMemo(() => {
    const parents = new Set<string>();
    for (const task of view.tasks) if (task.parentId) parents.add(task.parentId);
    return parents;
  }, [view.tasks]);

  /**
   * 被收起來的列。
   *
   * 沿著 parentId 往上走,只要路上有任何一個祖先是收合的就藏起來 —— 靠
   * WBS 前綴去猜會在代號重複時出錯(每個分組都從 1 重新開始)。
   */
  const hidden = useMemo(() => {
    if (collapsed.size === 0) return new Set<string>();
    const parentOf = new Map(view.tasks.map((t) => [t.id, t.parentId]));
    const out = new Set<string>();
    for (const task of view.tasks) {
      let cursor = task.parentId;
      const seen = new Set<string>();
      while (cursor && !seen.has(cursor)) {
        seen.add(cursor);
        if (collapsed.has(cursor)) {
          out.add(task.id);
          break;
        }
        cursor = parentOf.get(cursor) ?? null;
      }
    }
    return out;
  }, [collapsed, view.tasks]);

  // 全螢幕沒有視窗框可以按,Esc 是唯一直覺的出口。
  useEffect(() => {
    if (!isFullscreen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setIsFullscreen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isFullscreen]);

  function toggleCollapsed(id: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const rows = useMemo(() => {
    const out: Row[] = [];
    for (const board of view.boards) {
      if (boardFilterId && board.id !== boardFilterId) continue;
      const color = colorOfBoard.get(board.id)!;
      const tasks = view.tasks.filter(
        (t) =>
          t.boardId === board.id &&
          (!groupFilterId || t.groupId === groupFilterId) &&
          !hidden.has(t.id) &&
          (!onlyCritical || t.isCritical || t.isSummary)
      );
      // 篩掉之後整塊看板都空了就連標題一起收掉,不留一排只有名字的殼。
      if (tasks.length === 0 && (boardFilterId || groupFilterId)) continue;
      if (onlyCritical && tasks.every((t) => t.isSummary)) continue;
      out.push({
        kind: "board",
        boardId: board.id,
        boardName: board.name,
        taskCount: board.taskCount,
        color,
      });

      // 照分組切開。tasks 已經是看板 → 分組 → WBS 的順序,所以只要在分組
      // 換了的時候插一列標題就好,不必重新分群。
      let currentGroup: string | null = null;
      for (const task of tasks) {
        if (task.groupId !== currentGroup) {
          currentGroup = task.groupId;
          out.push({
            kind: "group",
            boardId: board.id,
            groupId: task.groupId,
            groupName: task.groupName,
            taskCount: tasks.filter((t) => t.groupId === task.groupId).length,
          });
        }
        out.push({ kind: "task", task, color });
      }
    }
    return out;
  }, [view.boards, view.tasks, colorOfBoard, onlyCritical, hidden, boardFilterId, groupFilterId]);

  /** 分組下拉的選項。選了看板就只列那塊看板的分組 —— 別塊的分組選了也篩不
   *  出東西。同名不同塊的分組是不同的分組,所以用 id 當鍵。 */
  const groupOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const task of view.tasks) {
      if (boardFilterId && task.boardId !== boardFilterId) continue;
      if (!seen.has(task.groupId)) seen.set(task.groupId, task.groupName);
    }
    return [...seen].map(([id, name]) => ({ id, name }));
  }, [view.tasks, boardFilterId]);

  /** Where every bar sits, derived rather than measured: the rows are a fixed
   *  height and nothing collapses, so the arithmetic is exact and there is no
   *  measure-then-repaint pass to get wrong. */
  const barBoxes = useMemo(() => {
    const boxes = new Map<string, BarBox>();
    let y = 0;
    for (const row of rows) {
      if (row.kind === "board" || row.kind === "group") {
        y += row.kind === "board" ? BOARD_ROW_H : GROUP_ROW_H;
        continue;
      }
      const { task } = row;
      const startIndex = task.start ? dayIndexByIso.get(task.start) : undefined;
      const endIndex = task.end ? dayIndexByIso.get(task.end) : undefined;
      if (startIndex !== undefined && endIndex !== undefined) {
        boxes.set(task.id, {
          left: startIndex * dayWidth,
          right: (endIndex + 1) * dayWidth,
          centerY: y + ROW_H / 2,
        });
      }
      y += ROW_H;
    }
    return boxes;
  }, [rows, dayIndexByIso, dayWidth]);

  const arrows = useMemo(() => {
    if (!showArrows) return [];
    const byId = new Map(view.tasks.map((t) => [t.id, t]));
    const links = view.tasks.flatMap((task) =>
      task.preds
        .filter((pred) => pred.relationship && byId.has(pred.predId))
        .map((pred) => ({
          predId: pred.predId,
          succId: task.id,
          relationship: pred.relationship as RelationshipType,
          // An arrow is on the critical path only when both ends are.
          critical:
            showCritical && task.isCritical && (byId.get(pred.predId)?.isCritical ?? false),
          crossBoard: pred.crossBoard,
          title: `${byId.get(pred.predId)?.name ?? ""} → ${task.name} (${pred.relationship})${
            pred.crossBoard ? " 跨看板" : ""
          }`,
        }))
    );
    const built = buildDependencyArrows(links, barBoxes);
    // buildDependencyArrows keeps the input order, so the cross-board flag
    // can be zipped back on — it decides how the arrow is drawn, and only the
    // links whose two ends are both on screen survive.
    const crossById = new Map(links.map((l) => [`${l.predId}->${l.succId}`, l.crossBoard]));
    return built.map((arrow) => ({ ...arrow, crossBoard: crossById.get(arrow.key) ?? false }));
  }, [view.tasks, barBoxes, showArrows, showCritical]);

  const todayIndex = dayIndexByIso.get(new Date().toISOString().slice(0, 10));
  const timelineWidth = days.length * dayWidth;
  const contentWidth = LABEL_WIDTH + timelineWidth;
  const scrollRef = useRef<HTMLDivElement>(null);
  const topScrollRef = useRef<HTMLDivElement>(null);
  const dragState = useRef<{ startX: number; startScrollLeft: number } | null>(null);
  const [isPanning, setIsPanning] = useState(false);

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

  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    const container = scrollRef.current;
    if (!container) return;
    if (!container.contains(e.target as Node)) return;
    // 長條本身是連結,拖曳不該把它當成點擊。
    if ((e.target as HTMLElement).closest("a,button")) return;
    dragState.current = { startX: e.clientX, startScrollLeft: container.scrollLeft };
    setIsPanning(true);
    container.setPointerCapture(e.pointerId);
  }

  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!dragState.current || !scrollRef.current) return;
    scrollRef.current.scrollLeft =
      dragState.current.startScrollLeft - (e.clientX - dragState.current.startX);
    syncFromMainScroll();
  }

  function handlePointerUp(e: React.PointerEvent<HTMLDivElement>) {
    dragState.current = null;
    setIsPanning(false);
    scrollRef.current?.releasePointerCapture?.(e.pointerId);
  }

  // 一年多的時間軸打開來停在最左邊,看到的是早就做完的那一段。跳到今天,
  // 留兩格在左邊當前後文。
  useEffect(() => {
    const el = scrollRef.current;
    // 今天不在這個專案的區間裡(整個做完了,或還沒開始)就維持在最左邊。
    if (!el || todayIndex === undefined) return;
    // 內容被 CSS zoom 縮放過,捲動距離是縮放後的像素 —— 少乘這一下,
    // 放大或縮小之後「今天」就不在畫面上了。
    el.scrollLeft = Math.max(0, (todayIndex - 2) * dayWidth * (scalePct / 100));
    if (topScrollRef.current) topScrollRef.current.scrollLeft = el.scrollLeft;
  }, [todayIndex, dayWidth, scalePct]);

  const totalHeight = rows.reduce(
    (h, row) => h + (row.kind === "board" ? BOARD_ROW_H : row.kind === "group" ? GROUP_ROW_H : ROW_H),
    0
  );

  if (days.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-neutral-200 dark:border-neutral-700 py-12 text-center text-sm text-neutral-400 dark:text-neutral-500">
        這個群組裡還沒有任何排好日期的工作項。
      </p>
    );
  }

  const toggleClass = (on: boolean) =>
    `flex items-center gap-1 rounded border px-2 py-1 text-xs ${
      on
        ? "border-blue-300 bg-blue-50 text-blue-700 dark:border-blue-700 dark:bg-blue-950 dark:text-blue-300"
        : "border-neutral-200 text-neutral-600 dark:border-neutral-700 dark:text-neutral-300"
    }`;

  return (
    <div
      className={
        isFullscreen
          ? "fixed inset-0 z-50 flex flex-col space-y-2 overflow-hidden bg-white p-4 dark:bg-neutral-950"
          : "space-y-2"
      }
    >
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          {(["day", "week", "month"] as Zoom[]).map((z) => (
            <button
              key={z}
              type="button"
              onClick={() => setZoom(z)}
              className={`rounded border px-2 py-1 text-xs ${
                zoom === z
                  ? "border-neutral-800 bg-neutral-800 text-white dark:border-neutral-200 dark:bg-neutral-200 dark:text-neutral-900"
                  : "border-neutral-200 text-neutral-600 dark:border-neutral-700 dark:text-neutral-300"
              }`}
            >
              {z === "day" ? "日" : z === "week" ? "週" : "月"}
            </button>
          ))}
        </div>
        <span className="ml-1 text-xs text-neutral-500 dark:text-neutral-400">顯示比例</span>
        <input
          type="range"
          min={50}
          max={150}
          step={5}
          value={scalePct}
          onChange={(e) => setScalePct(Number(e.target.value))}
          className="w-24"
          title="整張圖的縮放,跟時間刻度是兩件事"
        />
        <span className="w-9 text-xs tabular-nums text-neutral-500 dark:text-neutral-400">
          {scalePct}%
        </span>
        <button type="button" onClick={() => setShowCritical((v) => !v)} className={toggleClass(showCritical)}>
          <Zap size={12} /> 要徑 {view.criticalCount > 0 && `(${view.criticalCount})`}
        </button>
        <button type="button" onClick={() => setOnlyCritical((v) => !v)} className={toggleClass(onlyCritical)}>
          只看要徑
        </button>
        <button type="button" onClick={() => setShowArrows((v) => !v)} className={toggleClass(showArrows)}>
          <ArrowRightLeft size={12} /> 相依箭頭
        </button>
        <button
          type="button"
          onClick={() => setCollapsed(new Set(hasChildren))}
          className={toggleClass(false)}
          title="把所有有子項的工作項收起來"
        >
          <ChevronRight size={12} /> 全部收合
        </button>
        <button
          type="button"
          onClick={() => setCollapsed(new Set())}
          className={toggleClass(false)}
          title="展開全部"
        >
          <ChevronDown size={12} /> 全部展開
        </button>
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-neutral-500 dark:text-neutral-400">看板</span>
          <select
            value={boardFilterId}
            onChange={(e) => {
              setBoardFilterId(e.target.value);
              // 換了看板,原本選的分組多半不屬於它 —— 留著會篩出一片空白。
              setGroupFilterId("");
            }}
            className="max-w-[160px] rounded-md border border-neutral-300 px-2 py-1 text-xs outline-none focus:border-blue-500 dark:border-neutral-600 dark:bg-neutral-900"
          >
            <option value="">全部</option>
            {view.boards.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-neutral-500 dark:text-neutral-400">分組</span>
          <select
            value={groupFilterId}
            onChange={(e) => setGroupFilterId(e.target.value)}
            className="max-w-[180px] rounded-md border border-neutral-300 px-2 py-1 text-xs outline-none focus:border-blue-500 dark:border-neutral-600 dark:bg-neutral-900"
          >
            <option value="">全部</option>
            {groupOptions.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </div>
        {(boardFilterId || groupFilterId) && (
          <button
            type="button"
            onClick={() => {
              setBoardFilterId("");
              setGroupFilterId("");
            }}
            className="text-xs text-neutral-400 hover:text-neutral-700 dark:text-neutral-500 dark:hover:text-neutral-100"
          >
            清除
          </button>
        )}
        <span className="ml-auto flex items-center gap-1 text-xs text-neutral-500 dark:text-neutral-400">
          <span className="inline-block h-0.5 w-5 bg-blue-500" style={{ borderTop: "2px dashed" }} />
          跨看板相依 {view.crossBoardEdgeCount} 條
        </span>
        <button
          type="button"
          onClick={() => setIsFullscreen((v) => !v)}
          className="flex items-center gap-1 rounded-md border border-neutral-300 px-2 py-1 text-xs text-neutral-600 hover:bg-neutral-50 dark:border-neutral-600 dark:text-neutral-400 dark:hover:bg-neutral-800"
        >
          {isFullscreen ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
          {isFullscreen ? "退出全螢幕" : "全螢幕"}
        </button>
      </div>

      {/* 貼在頂端的水平捲軸:主容器自己的那條在三百多列底下,實際上碰不到。 */}
      <div
        ref={topScrollRef}
        onScroll={syncFromTopScroll}
        className="sticky top-0 z-30 mb-1 overflow-x-auto overflow-y-hidden bg-white dark:bg-neutral-900"
        style={{ height: 14 }}
      >
        {/* 內容被縮放過,這個佔位也要一起縮 —— 兩邊的可捲距離不一樣的話,
            拖上面那條捲軸,下面會跑到別的地方去。 */}
        <div style={{ width: contentWidth * (scalePct / 100), height: 1 }} />
      </div>
      <div
        ref={scrollRef}
        onScroll={syncFromMainScroll}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
        className={`${
          isFullscreen ? "min-h-0 flex-1" : "max-h-[70vh]"
        } overflow-auto rounded-lg border border-neutral-200 bg-white dark:border-neutral-700 dark:bg-neutral-900 ${
          isPanning ? "cursor-grabbing select-none" : "cursor-grab"
        }`}
      >
        {/* CSS zoom 會重新排版(跟 transform: scale 不同),所以捲動範圍、
            黏住的表頭與左欄都還是對的。 */}
        <div style={{ zoom: scalePct / 100 }}>
          <div style={{ minWidth: contentWidth }}>
            {/* Header */}
            <div className="sticky top-0 z-20 flex border-b border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800">
              <div
                className="sticky left-0 z-10 shrink-0 border-r border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800 px-3 py-2 text-xs font-medium text-neutral-600 dark:text-neutral-300"
                style={{ width: LABEL_WIDTH }}
              >
                工作項
              </div>
              <div className="relative flex" style={{ width: timelineWidth }}>
                {days.map((d) => {
                  const isoDate = toIso(d);
                  const off = isWeekend(d) || holidaySet.has(isoDate);
                  // At week/month zoom a per-day label is unreadable, so only
                  // the first day of each bucket carries one.
                  const label =
                    zoom === "day"
                      ? formatDay(d)
                      : zoom === "week"
                        ? d.getUTCDay() === 1
                          ? formatDay(d)
                          : ""
                        : d.getUTCDate() === 1
                          ? `${d.getUTCFullYear()}/${d.getUTCMonth() + 1}`
                          : "";
                  return (
                    <div
                      key={isoDate}
                      className={`shrink-0 overflow-visible whitespace-nowrap border-r border-neutral-100 dark:border-neutral-800 py-2 text-center text-[10px] ${
                        off ? "bg-neutral-100 dark:bg-neutral-900" : ""
                      } text-neutral-500 dark:text-neutral-400`}
                      style={{ width: dayWidth }}
                    >
                      {label}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Rows */}
            <div className="relative">
              {/* Arrows sit above the bars, offset to the timeline's origin. */}
              <svg
                className="pointer-events-none absolute z-10"
                style={{ left: LABEL_WIDTH, top: 0, width: timelineWidth, height: totalHeight }}
              >
                {arrows.map((arrow) => (
                  <g key={arrow.key}>
                    <title>{arrow.title}</title>
                    <path
                      d={arrow.path}
                      fill="none"
                      stroke={arrow.critical ? "#f59e0b" : arrow.crossBoard ? "#3b82f6" : "#9ca3af"}
                      strokeWidth={arrow.crossBoard ? 2 : 1}
                      strokeDasharray={arrow.crossBoard ? "4 3" : undefined}
                    />
                    <path
                      d={arrow.head}
                      fill={arrow.critical ? "#f59e0b" : arrow.crossBoard ? "#3b82f6" : "#9ca3af"}
                    />
                  </g>
                ))}
              </svg>

              {todayIndex !== undefined && (
                <div
                  className="pointer-events-none absolute z-10 w-px bg-red-500"
                  style={{ left: LABEL_WIDTH + todayIndex * dayWidth, top: 0, height: totalHeight }}
                />
              )}

              {rows.map((row) =>
                row.kind === "board" ? (
                  <div
                    key={`board-${row.boardId}`}
                    className="flex border-b border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800"
                    style={{ height: BOARD_ROW_H }}
                  >
                    <div
                      className="sticky left-0 z-10 flex shrink-0 items-center gap-2 border-r border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800 px-3"
                      style={{ width: LABEL_WIDTH }}
                    >
                      <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: row.color }} />
                      <Link
                        href={`/boards/${row.boardId}`}
                        className="truncate text-xs font-semibold text-neutral-800 dark:text-neutral-100 hover:text-blue-600"
                      >
                        {row.boardName}
                      </Link>
                      <span className="shrink-0 text-[10px] text-neutral-400 dark:text-neutral-500">
                        {row.taskCount} 項
                      </span>
                    </div>
                    <div style={{ width: timelineWidth }} />
                  </div>
                ) : row.kind === "group" ? (
                  <div
                    key={`group-${row.boardId}-${row.groupId}`}
                    className="flex border-b border-neutral-100 bg-neutral-50/60 dark:border-neutral-800 dark:bg-neutral-800/40"
                    style={{ height: GROUP_ROW_H }}
                  >
                    <div
                      className="sticky left-0 z-10 flex shrink-0 items-center gap-1.5 border-r border-neutral-200 bg-neutral-50/60 px-3 pl-6 dark:border-neutral-700 dark:bg-neutral-800/40"
                      style={{ width: LABEL_WIDTH }}
                    >
                      <span className="min-w-0 truncate text-[11px] font-medium text-neutral-600 dark:text-neutral-300">
                        {row.groupName || "(未分組)"}
                      </span>
                      <span className="shrink-0 text-[10px] text-neutral-400 dark:text-neutral-500">
                        {row.taskCount}
                      </span>
                    </div>
                    <div style={{ width: timelineWidth }} />
                  </div>
                ) : (
                  <TaskRow
                    key={row.task.id}
                    task={row.task}
                    color={row.color}
                    dayWidth={dayWidth}
                    days={days}
                    holidaySet={holidaySet}
                    dayIndexByIso={dayIndexByIso}
                    timelineWidth={timelineWidth}
                    showCritical={showCritical}
                    canCollapse={hasChildren.has(row.task.id)}
                    isCollapsed={collapsed.has(row.task.id)}
                    onToggleCollapsed={toggleCollapsed}
                    isOpeningDetail={openingItemId === row.task.id}
                    onOpenDetail={openItemDetail}
                  />
                )
              )}
            </div>
          </div>
        </div>
      </div>

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
        initialTab="card"
      />
    </div>
  );
}

function TaskRow({
  task,
  color,
  dayWidth,
  days,
  holidaySet,
  dayIndexByIso,
  timelineWidth,
  showCritical,
  canCollapse,
  isCollapsed,
  onToggleCollapsed,
  isOpeningDetail,
  onOpenDetail,
}: {
  task: ProgramTask;
  color: string;
  dayWidth: number;
  days: Date[];
  holidaySet: Set<string>;
  dayIndexByIso: Map<string, number>;
  timelineWidth: number;
  showCritical: boolean;
  /** 有子項才給收合把手。 */
  canCollapse: boolean;
  isCollapsed: boolean;
  onToggleCollapsed: (id: string) => void;
  isOpeningDetail: boolean;
  onOpenDetail: (itemId: string) => void;
}) {
  const startIndex = task.start ? dayIndexByIso.get(task.start) : undefined;
  const endIndex = task.end ? dayIndexByIso.get(task.end) : undefined;
  const isCritical = showCritical && task.isCritical && !task.isSummary;

  return (
    <div
      className="flex border-b border-neutral-100 dark:border-neutral-800 hover:bg-neutral-50 dark:hover:bg-neutral-800/50"
      style={{ height: ROW_H }}
    >
      <div
        className="sticky left-0 z-10 flex shrink-0 items-center gap-1.5 border-r border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-3"
        style={{ width: LABEL_WIDTH }}
      >
        <span style={{ width: task.depth * 12 }} className="shrink-0" />
        {canCollapse ? (
          <button
            type="button"
            onClick={() => onToggleCollapsed(task.id)}
            aria-label={isCollapsed ? "展開" : "收合"}
            className="shrink-0 rounded text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-neutral-700 dark:hover:text-neutral-100"
          >
            {isCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
          </button>
        ) : (
          // 沒有子項的列也要讓出同樣的寬度,否則同一層的名稱會對不齊。
          <span className="w-3 shrink-0" />
        )}
        <span className="shrink-0 text-[10px] tabular-nums text-neutral-400 dark:text-neutral-500">
          {task.wbsCode}
        </span>
        <button
          type="button"
          disabled={isOpeningDetail}
          onClick={() => onOpenDetail(task.id)}
          className={`min-w-0 flex-1 truncate text-left text-xs hover:text-blue-600 hover:underline disabled:opacity-60 ${
            task.isSummary
              ? "font-semibold text-neutral-800 dark:text-neutral-100"
              : "text-neutral-700 dark:text-neutral-200"
          }`}
          title={`${task.boardName} / ${task.groupName}\n${task.name}${
            task.totalFloat !== null ? `\n總浮時 ${task.totalFloat} 天` : ""
          }`}
        >
          {task.name}
        </button>
        {task.preds.some((p) => p.crossBoard) && (
          <ArrowRightLeft size={11} className="shrink-0 text-blue-500" aria-label="有跨看板前置" />
        )}
      </div>

      <div className="relative shrink-0" style={{ width: timelineWidth }}>
        <div className="absolute inset-0 flex">
          {days.map((d) => {
            const isoDate = toIso(d);
            const off = isWeekend(d) || holidaySet.has(isoDate);
            return (
              <div
                key={isoDate}
                className={`shrink-0 border-r border-neutral-50 dark:border-neutral-800/60 ${
                  off ? "bg-neutral-50 dark:bg-neutral-800/40" : ""
                }`}
                style={{ width: dayWidth }}
              />
            );
          })}
        </div>
        {startIndex !== undefined && endIndex !== undefined && (
          <div
            className={`absolute top-1/2 flex -translate-y-1/2 items-center rounded ${
              isCritical ? "ring-2 ring-amber-400" : ""
            }`}
            style={{
              left: startIndex * dayWidth,
              width: Math.max((endIndex - startIndex + 1) * dayWidth, 4),
              height: task.isSummary ? 8 : 14,
              backgroundColor: task.isMilestone ? "transparent" : color,
              opacity: task.isSummary ? 0.45 : 1,
            }}
            title={`${task.name}\n${task.start} ~ ${task.end}${
              task.assigneeNames.length ? `\n${task.assigneeNames.join(", ")}` : ""
            }`}
          >
            {task.isMilestone ? (
              <Star size={14} className="fill-amber-400 text-amber-500" />
            ) : (
              isCritical && (
                <span className="ml-0.5 flex h-3 w-3 items-center justify-center rounded-full bg-black">
                  <Zap size={8} className="fill-amber-400 text-amber-400" />
                </span>
              )
            )}
          </div>
        )}
      </div>
    </div>
  );
}
