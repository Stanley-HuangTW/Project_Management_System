"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Plus } from "lucide-react";
import {
  HOUR_PX,
  MIN_EVENT_MINUTES,
  endMinuteOf,
  layoutDayEvents,
  minuteToPx,
  pxToMinute,
  selectionToSlot,
  snapHours,
  snapToGrid,
} from "@/lib/calendarLayout";
import { MINUTES_PER_DAY, formatMinute } from "@/lib/timeOfDay";
import { dayTotalHours, type CalendarEvent } from "./timesheetEvents";

const WEEKDAY_LABELS = ["週日", "週一", "週二", "週三", "週四", "週五", "週六"];
const GRID_HEIGHT = 24 * HOUR_PX;
const DRAG_THRESHOLD_PX = 4;
const AXIS_WIDTH = "3.5rem";
/** 每天欄位右邊不放工時的空白寬度,留給「在已有工時的時段上再新增一筆」。 */
const EMPTY_STRIP_PX = 10;

function fmt(hours: number): string {
  return String(Number(hours.toFixed(2)));
}

function weekdayOf(dateIso: string): string {
  return WEEKDAY_LABELS[new Date(`${dateIso}T00:00:00Z`).getUTCDay()];
}

/** 台灣現在是一天中的第幾分鐘(固定 UTC+8)。 */
function taipeiMinute(): number {
  const d = new Date(Date.now() + 8 * 3_600_000);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

function eventClass(e: CalendarEvent): string {
  if (e.status === "REJECTED") return "border-red-400 bg-red-100 text-red-800 dark:border-red-700 dark:bg-red-950 dark:text-red-200";
  const tone =
    e.kind === "project"
      ? "border-blue-600 bg-blue-500 text-white"
      : e.activity?.boardId
        ? "border-violet-600 bg-violet-500 text-white"
        : "border-emerald-700 bg-emerald-600 text-white";
  return e.status === "PENDING" ? `${tone} border-dashed opacity-75` : tone;
}

type DragState = {
  key: string;
  mode: "move" | "resize";
  startX: number;
  startY: number;
  moved: boolean;
  deltaMinutes: number;
  targetIndex: number;
};

type SelectionState = { date: string; anchor: number; current: number; startY: number; moved: boolean };

/**
 * 工時週視圖(像 Google 行事曆):每天一欄、左邊是時間軸。
 * - 在空白處按一下 / 拖出一段時間 → 新增一筆;
 * - 點一筆 → 開啟編輯;拖曳整塊 → 換時間或換天;拖下緣 → 改時數;
 * - 日期底下顯示這一天已登記的小時,沒排時間的工時列在日期下面。
 */
export function WeekCalendar({
  days,
  events,
  today,
  busy,
  estimateByDay,
  onCreate,
  onOpen,
  onMove,
  onResize,
}: {
  days: string[];
  events: CalendarEvent[];
  today: string;
  busy: boolean;
  /** 每天的預估小時(人力表、工作項),顯示在日期底下;沒給就不顯示。 */
  estimateByDay?: Record<string, { labour: number; work: number }>;
  onCreate: (slot: { date: string; startMinute: number | null; hours: number }) => void;
  onOpen: (event: CalendarEvent) => void;
  onMove: (event: CalendarEvent, to: { date: string; startMinute: number }) => void;
  onResize: (event: CalendarEvent, hours: number) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const columnsRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [selection, setSelection] = useState<SelectionState | null>(null);
  const [nowMinute, setNowMinute] = useState(() => taipeiMinute());

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 7 * HOUR_PX - 10;
  }, []);
  useEffect(() => {
    const id = setInterval(() => setNowMinute(taipeiMinute()), 60_000);
    return () => clearInterval(id);
  }, []);

  /** 拖曳途中被拖的那一筆,顯示在放開後會落的位置。 */
  const displayed = useMemo(
    () =>
      events.map((e) => {
        if (!drag || drag.key !== e.key || e.startMinute === null) return { event: e, date: e.date, start: e.startMinute, hours: e.hours };
        if (drag.mode === "resize") {
          const maxHours = (MINUTES_PER_DAY - e.startMinute) / 60;
          return { event: e, date: e.date, start: e.startMinute, hours: Math.min(maxHours, snapHours(e.hours + drag.deltaMinutes / 60)) };
        }
        const start = Math.min(snapToGrid(e.startMinute + drag.deltaMinutes), MINUTES_PER_DAY - Math.round(e.hours * 60));
        return { event: e, date: days[drag.targetIndex] ?? e.date, start, hours: e.hours };
      }),
    [events, drag, days]
  );

  const layouts = useMemo(() => {
    const byDate = new Map<string, Map<string, { lane: number; lanes: number }>>();
    for (const date of days) {
      const dayEvents = displayed.filter((d) => d.date === date && d.start !== null);
      byDate.set(
        date,
        layoutDayEvents(dayEvents.map((d) => ({ key: d.event.key, startMinute: d.start!, endMinute: endMinuteOf(d.start!, d.hours) })))
      );
    }
    return byDate;
  }, [displayed, days]);

  function columnIndexAt(clientX: number): number {
    const rect = columnsRef.current?.getBoundingClientRect();
    if (!rect) return 0;
    return Math.min(days.length - 1, Math.max(0, Math.floor((clientX - rect.left) / (rect.width / days.length))));
  }

  // ---- 空白處:新增 ----
  function selectionDown(date: string, e: React.PointerEvent<HTMLDivElement>) {
    if (e.button !== 0 || busy) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const minute = pxToMinute(e.clientY - rect.top);
    e.currentTarget.setPointerCapture(e.pointerId);
    setSelection({ date, anchor: minute, current: minute, startY: e.clientY, moved: false });
  }
  function selectionMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!selection) return;
    const rect = e.currentTarget.getBoundingClientRect();
    setSelection({
      ...selection,
      current: pxToMinute(e.clientY - rect.top),
      moved: selection.moved || Math.abs(e.clientY - selection.startY) >= DRAG_THRESHOLD_PX,
    });
  }
  function selectionUp() {
    if (!selection) return;
    const s = selection;
    setSelection(null);
    if (!s.moved) {
      // 只點一下:從那一格開始排一小時。
      const start = Math.min(Math.floor(s.anchor / 15) * 15, MINUTES_PER_DAY - 60);
      onCreate({ date: s.date, startMinute: Math.max(0, start), hours: 1 });
      return;
    }
    const slot = selectionToSlot(s.anchor, s.current);
    onCreate({ date: s.date, ...slot });
  }

  // ---- 一筆工時:點開、拖曳、拉長 ----
  function dragDown(event: CalendarEvent, mode: DragState["mode"], e: React.PointerEvent<HTMLElement>) {
    if (e.button !== 0 || busy) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag({
      key: event.key,
      mode,
      startX: e.clientX,
      startY: e.clientY,
      moved: false,
      deltaMinutes: 0,
      targetIndex: Math.max(0, days.indexOf(event.date)),
    });
  }
  function dragMove(event: CalendarEvent, e: React.PointerEvent<HTMLElement>) {
    if (!drag || drag.key !== event.key) return;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    setDrag({
      ...drag,
      moved: drag.moved || Math.abs(dx) >= DRAG_THRESHOLD_PX || Math.abs(dy) >= DRAG_THRESHOLD_PX,
      deltaMinutes: pxToMinute(dy),
      targetIndex: drag.mode === "move" ? columnIndexAt(e.clientX) : drag.targetIndex,
    });
  }
  function dragUp(event: CalendarEvent) {
    if (!drag || drag.key !== event.key) return;
    const d = drag;
    setDrag(null);
    if (!d.moved) {
      if (d.mode === "move") onOpen(event);
      return;
    }
    if (event.startMinute === null) return;
    if (d.mode === "resize") {
      const maxHours = (MINUTES_PER_DAY - event.startMinute) / 60;
      const hours = Math.min(maxHours, snapHours(event.hours + d.deltaMinutes / 60));
      if (hours !== event.hours) onResize(event, hours);
      return;
    }
    const start = Math.min(snapToGrid(event.startMinute + d.deltaMinutes), MINUTES_PER_DAY - Math.round(event.hours * 60));
    const date = days[d.targetIndex] ?? event.date;
    if (date !== event.date || start !== event.startMinute) onMove(event, { date, startMinute: start });
  }

  const selectionSlot = selection?.moved ? selectionToSlot(selection.anchor, selection.current) : null;

  return (
    <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white dark:border-neutral-700 dark:bg-neutral-900">
      <div className="min-w-[860px]">
        {/* 日期列:星期、日期、這一天的小時合計,以及沒排時間的工時 */}
        <div className="flex border-b border-neutral-200 dark:border-neutral-700">
          <div className="shrink-0" style={{ width: AXIS_WIDTH }} />
          <div className="grid min-w-0 flex-1" style={{ gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))` }}>
            {days.map((date) => {
              const isToday = date === today;
              const total = dayTotalHours(events, date);
              const unscheduled = events.filter((e) => e.date === date && e.startMinute === null);
              return (
                <div key={date} className="min-w-0 border-l border-neutral-100 px-1.5 py-1.5 dark:border-neutral-800">
                  <div className="flex items-start justify-between gap-1">
                    <div className="min-w-0">
                      <div className={`text-xs ${isToday ? "font-medium text-blue-600 dark:text-blue-400" : "text-neutral-500 dark:text-neutral-400"}`}>
                        {weekdayOf(date)}
                      </div>
                      <div
                        className={`mt-0.5 inline-flex h-7 min-w-7 items-center justify-center rounded-full px-1 text-base font-medium ${
                          isToday ? "bg-blue-600 text-white" : "text-neutral-800 dark:text-neutral-100"
                        }`}
                      >
                        {Number(date.slice(8))}
                      </div>
                      <div className="mt-0.5 text-[11px] tabular-nums text-neutral-500 dark:text-neutral-400" title="這一天已登記的小時">
                        {total > 0 ? `${fmt(total)} 小時` : "—"}
                      </div>
                      {(estimateByDay?.[date]?.labour || estimateByDay?.[date]?.work) ? (
                        <div
                          className="text-[10px] tabular-nums text-neutral-400 dark:text-neutral-500"
                          title={`預估:人力表 ${fmt(estimateByDay[date].labour)} 小時、工作項 ${fmt(estimateByDay[date].work)} 小時(詳見下方「預估對照」)`}
                        >
                          預估 {fmt(estimateByDay[date].labour || estimateByDay[date].work)}
                        </div>
                      ) : null}
                    </div>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => onCreate({ date, startMinute: null, hours: 1 })}
                      className="mt-0.5 shrink-0 rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-blue-600 disabled:opacity-40 dark:hover:bg-neutral-800"
                      aria-label={`新增 ${date} 的工時(不排時間)`}
                      title="新增一筆(不排時間)"
                    >
                      <Plus size={14} />
                    </button>
                  </div>
                  {unscheduled.length > 0 && (
                    <div className="mt-1 space-y-0.5">
                      {unscheduled.map((e) => (
                        <button
                          key={e.key}
                          type="button"
                          onClick={() => onOpen(e)}
                          className={`block w-full truncate rounded border px-1 py-0.5 text-left text-[11px] ${eventClass(e)}`}
                          title={`${e.title}(未排時間)`}
                        >
                          {fmt(e.hours)}h {e.title}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* 時間格 */}
        <div ref={scrollRef} className="max-h-[68vh] overflow-y-auto">
          <div className="flex" style={{ height: GRID_HEIGHT }}>
            <div className="relative shrink-0" style={{ width: AXIS_WIDTH }}>
              {Array.from({ length: 24 }, (_, h) => (
                <div
                  key={h}
                  className="absolute right-1.5 -translate-y-1/2 text-[10px] tabular-nums text-neutral-400 dark:text-neutral-500"
                  style={{ top: h * HOUR_PX }}
                >
                  {h === 0 ? "" : `${String(h).padStart(2, "0")}:00`}
                </div>
              ))}
            </div>

            <div
              ref={columnsRef}
              className="relative grid min-w-0 flex-1"
              style={{ gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))` }}
            >
              {days.map((date) => {
                return (
                  <div
                    key={date}
                    className="relative cursor-crosshair touch-none border-l border-neutral-100 dark:border-neutral-800"
                    style={{
                      backgroundImage:
                        "repeating-linear-gradient(to bottom, transparent 0, transparent calc(var(--hour) - 1px), rgb(128 128 128 / 0.2) calc(var(--hour) - 1px), rgb(128 128 128 / 0.2) var(--hour))",
                      ["--hour" as string]: `${HOUR_PX}px`,
                    }}
                    onPointerDown={(e) => selectionDown(date, e)}
                    onPointerMove={selectionMove}
                    onPointerUp={selectionUp}
                    onPointerCancel={() => setSelection(null)}
                  >
                    {date === today && (
                      <div
                        className="pointer-events-none absolute left-0 right-0 z-10 h-px bg-red-500"
                        style={{ top: minuteToPx(nowMinute) }}
                      >
                        <span className="absolute -left-1 -top-1 h-2 w-2 rounded-full bg-red-500" />
                      </div>
                    )}

                    {selection?.date === date && selectionSlot && (
                      <div
                        className="pointer-events-none absolute left-0.5 right-0.5 rounded border border-blue-500 bg-blue-500/20 px-1 text-[11px] text-blue-700 dark:text-blue-300"
                        style={{
                          top: minuteToPx(selectionSlot.startMinute),
                          height: minuteToPx(selectionSlot.hours * 60),
                        }}
                      >
                        {formatMinute(selectionSlot.startMinute)}–{formatMinute(endMinuteOf(selectionSlot.startMinute, selectionSlot.hours))}
                      </div>
                    )}

                  </div>
                );
              })}

              {/*
                工時放在蓋在所有欄位上的同一層,而不是各欄裡面:拖曳換天時它的 DOM 節點不會被換掉,
                不然瀏覽器會丟掉這次拖曳的 pointer capture,放開滑鼠時就收不到事件。
              */}
              <div className="pointer-events-none absolute inset-0">
                {displayed
                  .filter((d) => d.start !== null && days.includes(d.date))
                  .map(({ event, date, start, hours }) => {
                    const col = days.indexOf(date);
                    const slot = (layouts.get(date) ?? new Map()).get(event.key) ?? { lane: 0, lanes: 1 };
                    const height = Math.max(minuteToPx(hours * 60), minuteToPx(MIN_EVENT_MINUTES));
                    const dragging = drag?.key === event.key && drag.moved;
                    // 一欄的寬度扣掉右邊的空白條,再依並排的車道數均分。
                    const colWidth = `(100% / ${days.length})`;
                    const inner = `(${colWidth} - ${EMPTY_STRIP_PX}px)`;
                    return (
                      <div
                        key={event.key}
                        role="button"
                        tabIndex={0}
                        title={`${event.title}\n${formatMinute(start!)}–${formatMinute(endMinuteOf(start!, hours))}(${fmt(hours)} 小時)`}
                        onPointerDown={(e) => dragDown(event, "move", e)}
                        onPointerMove={(e) => dragMove(event, e)}
                        onPointerUp={() => dragUp(event)}
                        onPointerCancel={() => setDrag(null)}
                        onLostPointerCapture={() => setDrag((d) => (d?.key === event.key ? null : d))}
                        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onOpen(event))}
                        className={`pointer-events-auto absolute z-20 cursor-pointer touch-none select-none overflow-hidden rounded border px-1.5 py-0.5 text-xs leading-tight shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-blue-400 ${eventClass(event)} ${
                          dragging ? "z-30 ring-2 ring-blue-400" : ""
                        }`}
                        style={{
                          top: minuteToPx(start!),
                          height,
                          // 右邊留一條空白,讓使用者在已有工時的時段旁邊還能拖出新的(像 Google 行事曆)。
                          left: `calc(${col} * ${colWidth} + ${slot.lane / slot.lanes} * ${inner} + 1px)`,
                          width: `calc(${inner} / ${slot.lanes} - 3px)`,
                        }}
                      >
                        <div className="flex items-center gap-1">
                          <span className="min-w-0 flex-1 truncate font-medium">
                          {event.seriesId && <span title="重複建立的">↻ </span>}
                          {event.title}
                        </span>
                          {event.status === "PENDING" && <span className="shrink-0 rounded bg-white/25 px-1 text-[9px]">待審</span>}
                          {event.status === "REJECTED" && <span className="shrink-0 text-[9px]">已退回</span>}
                        </div>
                        {height >= 34 && (
                          <div className="truncate text-[10px] opacity-90">
                            {formatMinute(start!)}–{formatMinute(endMinuteOf(start!, hours))} · {fmt(hours)}h
                          </div>
                        )}
                        {height >= 56 && event.subtitle && <div className="truncate text-[10px] opacity-80">{event.subtitle}</div>}
                        <div
                          className="absolute inset-x-0 bottom-0 h-1.5 cursor-ns-resize"
                          onPointerDown={(e) => dragDown(event, "resize", e)}
                          onPointerMove={(e) => dragMove(event, e)}
                          onPointerUp={(e) => {
                            e.stopPropagation();
                            dragUp(event);
                          }}
                          aria-label="拖曳改時數"
                        />
                      </div>
                    );
                  })}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
