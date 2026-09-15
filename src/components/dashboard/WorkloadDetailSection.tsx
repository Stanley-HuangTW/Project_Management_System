"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight, Plus } from "lucide-react";
import {
  colorForPct,
  groupTasksByBoardAndGroup,
  weekIndexForDate,
  type WorkloadThresholdSettings,
  type MemberTask,
  type WeekColumn,
} from "@/lib/workload";
import { createTeamSubtask } from "@/lib/actions/teamTask";
import { loadItemScheduleContext, type ItemScheduleContext } from "@/lib/actions/itemSchedule";
import { AssignmentModal } from "@/components/board/AssignmentModal";
import { useDialogs } from "@/components/ui/DialogProvider";
import type { UserOption } from "@/types/board";
import type { UserRole } from "@prisma/client";
import { findTreeNode, firstTreeItemId, type ParentTreeNode } from "@/lib/parentTaskTree";
import { ParentTaskPicker } from "./ParentTaskPicker";

const DEFAULT_LABEL_WIDTH = 140;
const MIN_LABEL_WIDTH = 90;
const MAX_LABEL_WIDTH = 460;
const WEEK_WIDTH = 26;
const DAY_MS = 86_400_000;

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDaysIso(iso: string, days: number): string {
  return toIsoDate(new Date(new Date(iso).getTime() + days * DAY_MS));
}

function daysBetweenIso(startIso: string, endIso: string): number {
  return Math.round((new Date(endIso).getTime() - new Date(startIso).getTime()) / DAY_MS) + 1;
}

export function WorkloadDetailSection({
  users,
  tasksByUser,
  weeks,
  weeklyLoadByUser,
  threshold,
  canCreateSubtask,
  parentTaskTree,
  allUsers,
  currentUserId,
  userRole,
}: {
  users: { id: string; name: string }[];
  tasksByUser: Record<string, MemberTask[]>;
  weeks: WeekColumn[];
  weeklyLoadByUser: Record<string, number[]>;
  threshold: WorkloadThresholdSettings;
  canCreateSubtask: boolean;
  parentTaskTree: ParentTreeNode[];
  /** Everyone assignable, for the 人員分配 modal a bar click opens — wider
   *  than `users`, which is only the members this timeline charts. */
  allUsers: UserOption[];
  currentUserId: string;
  userRole: UserRole;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [labelWidth, setLabelWidth] = useState(DEFAULT_LABEL_WIDTH);
  const { notify } = useDialogs();

  const [creatingForUserId, setCreatingForUserId] = useState<string | null>(null);
  const [anchorIdx, setAnchorIdx] = useState<number | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [formStartDate, setFormStartDate] = useState("");
  const [formDays, setFormDays] = useState(7);
  const [formPct, setFormPct] = useState(100);
  const [formName, setFormName] = useState("");
  const [formParentId, setFormParentId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Clicking a task bar opens the same 人員分配 modal the Gantt uses, so the
  // item's Start/Finish/Pred/Link/Lag and everyone's allocation % are in one
  // place. Its data is fetched per click — see loadItemScheduleContext.
  const [scheduleContext, setScheduleContext] = useState<ItemScheduleContext | null>(null);
  const [openingItemId, setOpeningItemId] = useState<string | null>(null);

  async function openTask(itemId: string) {
    setOpeningItemId(itemId);
    try {
      const context = await loadItemScheduleContext(itemId);
      if (!context) {
        await notify("權限不足:僅該項目的負責人或管理者可以調整人員分配");
        return;
      }
      setScheduleContext(context);
    } catch (err) {
      await notify(err instanceof Error ? err.message : "載入失敗");
    } finally {
      setOpeningItemId(null);
    }
  }

  /** A schedule edit recomputes Start/Finish server-side, so the snapshot the
   *  modal is showing has to be re-read. */
  async function reloadOpenTask() {
    const itemId = scheduleContext?.item.id;
    if (!itemId) return;
    const context = await loadItemScheduleContext(itemId);
    if (context) setScheduleContext(context);
  }

  function startLabelResize(e: React.PointerEvent) {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = labelWidth;
    function onMove(ev: PointerEvent) {
      const next = startWidth + (ev.clientX - startX);
      setLabelWidth(Math.min(MAX_LABEL_WIDTH, Math.max(MIN_LABEL_WIDTH, next)));
    }
    function onUp() {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  const selectedParentNode = formParentId ? findTreeNode(parentTaskTree, formParentId) : null;
  const formMinDate = selectedParentNode?.startDate ? toIsoDate(selectedParentNode.startDate) : undefined;
  const formMaxDate = selectedParentNode?.endDate ? toIsoDate(selectedParentNode.endDate) : undefined;

  const timelineWidth = weeks.length * WEEK_WIDTH;
  const timelineOrigin = weeks[0]?.start ?? null;
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  // The timeline runs far wider than the pane and the member list runs long,
  // so panning sideways shouldn't mean scrolling to the bottom of the list to
  // reach a scrollbar — there's a second one above the dates, kept in step
  // with the real one below.
  const topScrollRef = useRef<HTMLDivElement>(null);
  const syncingScroll = useRef(false);
  function syncScrollLeft(from: "top" | "main") {
    if (syncingScroll.current) return;
    const source = from === "top" ? topScrollRef.current : scrollContainerRef.current;
    const target = from === "top" ? scrollContainerRef.current : topScrollRef.current;
    if (!source || !target || target.scrollLeft === source.scrollLeft) return;
    syncingScroll.current = true;
    target.scrollLeft = source.scrollLeft;
    requestAnimationFrame(() => {
      syncingScroll.current = false;
    });
  }
  const today = toIsoDate(new Date());
  const todayOffsetPx = timelineOrigin
    ? ((new Date(today).getTime() - timelineOrigin.getTime()) / DAY_MS / 7) * WEEK_WIDTH
    : null;

  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el || todayOffsetPx === null) return;
    el.scrollLeft = Math.max(0, labelWidth + todayOffsetPx - el.clientWidth / 2);
    if (topScrollRef.current) topScrollRef.current.scrollLeft = el.scrollLeft;
    // Only center on today once, when the timeline first renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const monthGroups: { label: string; count: number }[] = [];
  for (const week of weeks) {
    const last = monthGroups[monthGroups.length - 1];
    if (last && last.label === week.monthLabel) last.count += 1;
    else monthGroups.push({ label: week.monthLabel, count: 1 });
  }

  function toggle(userId: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  }

  function startCreating(userId: string) {
    setCreatingForUserId(userId);
    setAnchorIdx(null);
    setFormStartDate(toIsoDate(new Date()));
    setFormDays(7);
    setFormPct(100);
    setFormName("");
    setFormParentId(firstTreeItemId(parentTaskTree));
    setFormError(null);
  }

  function resetCreating() {
    setCreatingForUserId(null);
    setAnchorIdx(null);
    setFormStartDate("");
    setFormDays(7);
    setFormPct(100);
    setFormName("");
    setFormParentId("");
    setFormError(null);
  }

  // Ends a drag no matter where the pointer is released, even outside the timeline.
  useEffect(() => {
    if (!isDragging) return;
    const onPointerUp = () => setIsDragging(false);
    window.addEventListener("pointerup", onPointerUp);
    return () => window.removeEventListener("pointerup", onPointerUp);
  }, [isDragging]);

  /** Dragging the timeline is a rough quick-pick: pointer-down sets a fresh
   *  anchor week, dragging over other weeks redraws [anchor, current] as
   *  whole weeks into the Start/Days fields below — which stay freely
   *  editable for day-level precision afterward. A plain click (no drag)
   *  just picks that single week. */
  function handleWeekPointerDown(userId: string, weekIdx: number) {
    if (creatingForUserId !== userId) return;
    setAnchorIdx(weekIdx);
    setFormStartDate(toIsoDate(weeks[weekIdx].start));
    setFormDays(7);
    setIsDragging(true);
  }

  function handleWeekPointerEnter(userId: string, weekIdx: number) {
    if (creatingForUserId !== userId || !isDragging || anchorIdx === null) return;
    const start = Math.min(anchorIdx, weekIdx);
    const end = Math.max(anchorIdx, weekIdx);
    setFormStartDate(toIsoDate(weeks[start].start));
    setFormDays((end - start + 1) * 7);
  }

  function handleEndDateChange(value: string) {
    if (!formStartDate || !value) return;
    const days = daysBetweenIso(formStartDate, value);
    if (days >= 1) setFormDays(days);
  }

  function handleDaysChange(value: number) {
    if (Number.isFinite(value) && value >= 1) setFormDays(Math.round(value));
  }

  async function handleCreate(userId: string) {
    if (!formParentId) {
      setFormError("請選擇父任務");
      return;
    }
    if (!formStartDate) {
      setFormError("請輸入起始日期");
      return;
    }
    if (!Number.isFinite(formDays) || formDays < 1) {
      setFormError("天數需大於 0");
      return;
    }
    if (!Number.isFinite(formPct) || formPct < 1 || formPct > 100) {
      setFormError("百分比需介於 1 到 100 之間");
      return;
    }
    const rangeEnd = addDaysIso(formStartDate, formDays - 1);
    if ((formMinDate && formStartDate < formMinDate) || (formMaxDate && rangeEnd > formMaxDate)) {
      setFormError("子任務時程需在父任務的時間範圍內");
      return;
    }
    setSubmitting(true);
    setFormError(null);
    try {
      await createTeamSubtask({
        parentItemId: formParentId,
        assigneeUserId: userId,
        name: formName.trim() || "新任務",
        startDate: formStartDate,
        days: formDays,
        allocationPct: formPct,
      });
      resetCreating();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "建立失敗");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-neutral-700 dark:text-neutral-100">成員工作量明細</h2>
      </div>

      {users.length === 0 ? (
        <p className="text-sm text-neutral-400 dark:text-neutral-500">目前沒有成員資料。</p>
      ) : (
        <>
        <div
          ref={topScrollRef}
          onScroll={() => syncScrollLeft("top")}
          className="overflow-x-auto overflow-y-hidden"
        >
          <div style={{ width: labelWidth + timelineWidth, height: 1 }} />
        </div>
        <div
          ref={scrollContainerRef}
          onScroll={() => syncScrollLeft("main")}
          className="max-h-[70vh] overflow-auto"
        >
          <div className="relative" style={{ width: labelWidth + timelineWidth }}>
            {todayOffsetPx !== null && (
              <div
                className="pointer-events-none absolute top-0 bottom-0 z-20 w-px bg-red-400"
                style={{ left: labelWidth + todayOffsetPx }}
                title="今天"
              />
            )}
            {/* Stays put while the member rows scroll under it, so a bar
                further down the list still has its weeks labelled. */}
            <div className="sticky top-0 z-10 mb-2 bg-white pb-2 dark:bg-neutral-900">
            <div className="overflow-hidden rounded-md border border-neutral-200 dark:border-neutral-700">
              <div className="flex border-b border-neutral-100 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800 text-[10px] font-medium text-neutral-500 dark:text-neutral-400">
                <div
                  style={{ width: labelWidth }}
                  className="relative shrink-0 border-r border-neutral-100 dark:border-neutral-700 px-2 py-1"
                >
                  成員
                  <div
                    onPointerDown={startLabelResize}
                    title="拖曳調整名稱欄寬度"
                    className="absolute right-0 top-0 z-20 h-full w-1 cursor-col-resize hover:bg-blue-400"
                    style={{ touchAction: "none" }}
                  />
                </div>
                <div className="flex">
                  {monthGroups.map((g, i) => (
                    <div
                      key={`${g.label}-${i}`}
                      style={{ width: g.count * WEEK_WIDTH }}
                      className="shrink-0 truncate border-r border-neutral-100 dark:border-neutral-700 px-1 py-1"
                    >
                      {g.label}
                    </div>
                  ))}
                </div>
              </div>
              <div className="flex bg-neutral-50 dark:bg-neutral-800 text-[9px] text-neutral-400 dark:text-neutral-500">
                <div style={{ width: labelWidth }} className="shrink-0 border-r border-neutral-100 dark:border-neutral-700" />
                <div className="flex">
                  {weeks.map((w, i) => (
                    <div
                      key={i}
                      style={{ width: WEEK_WIDTH }}
                      className={`shrink-0 truncate text-center ${w.isMonthStart ? "border-l border-neutral-300 dark:border-neutral-600" : ""}`}
                    >
                      {w.label}
                    </div>
                  ))}
                </div>
              </div>
            </div>
            </div>

            <div className="space-y-2">
              {users.map((user) => {
                const tasks = tasksByUser[user.id] ?? [];
                const weekly = weeklyLoadByUser[user.id] ?? [];
                const isOpen = expanded.has(user.id);
                const isCreating = creatingForUserId === user.id;

                // Day-precise range for this user's in-progress pick, expressed
                // as an offset in days from the timeline's first week — used to
                // draw both the fractional overlay bar and the week highlight.
                const rangeStartDays =
                  isCreating && formStartDate && timelineOrigin
                    ? (new Date(formStartDate).getTime() - timelineOrigin.getTime()) / DAY_MS
                    : null;
                const rangeEndDays = rangeStartDays !== null ? rangeStartDays + formDays - 1 : null;
                const rangeLeftPx = rangeStartDays !== null ? (rangeStartDays / 7) * WEEK_WIDTH : 0;
                const formEndDate = formStartDate ? addDaysIso(formStartDate, formDays - 1) : "";

                const overlappingWeekLoad =
                  rangeStartDays !== null && rangeEndDays !== null
                    ? weeks
                        .map((_, i) => i)
                        .filter((i) => i * 7 + 6 >= rangeStartDays && i * 7 <= rangeEndDays)
                        .map((i) => weekly[i] ?? 0)
                    : [];
                const existingLoad = Math.max(0, ...overlappingWeekLoad);
                const projectedMax = existingLoad + formPct;

                return (
                  <div
                    key={user.id}
                    className="overflow-hidden rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900"
                  >
                    <button
                      type="button"
                      onClick={() => toggle(user.id)}
                      className="flex w-full items-center text-left hover:bg-neutral-50 dark:hover:bg-neutral-800"
                    >
                      <div
                        style={{ width: labelWidth }}
                        className="flex shrink-0 items-center gap-1 border-r border-neutral-100 dark:border-neutral-700 px-2 py-2"
                      >
                        {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                        <span className="min-w-0 flex-1 truncate text-sm font-medium text-neutral-800 dark:text-neutral-100">
                          {user.name}
                        </span>
                        <span className="shrink-0 text-[10px] text-neutral-400 dark:text-neutral-500">{tasks.length}</span>
                      </div>
                      <div className="flex">
                        {weeks.map((w, i) => (
                          <div
                            key={i}
                            title={`${w.label}: ${weekly[i] ?? 0}%`}
                            className={w.isMonthStart ? "border-l border-neutral-200 dark:border-neutral-700" : ""}
                            style={{
                              width: WEEK_WIDTH,
                              height: 20,
                              backgroundColor: colorForPct(weekly[i] ?? 0, threshold),
                              opacity: (weekly[i] ?? 0) > 0 ? 1 : 0.25,
                            }}
                          />
                        ))}
                      </div>
                    </button>

                    {isOpen && (
                      <div className="border-t border-neutral-100 dark:border-neutral-700 bg-neutral-50/50 dark:bg-neutral-800/50 pb-1">
                        {tasks.length === 0 ? (
                          <p className="px-2 py-2 text-xs text-neutral-400 dark:text-neutral-500">目前沒有指派中的任務</p>
                        ) : (
                          groupTasksByBoardAndGroup(tasks).flatMap((b) => [
                            <div
                              key={`board-${b.boardId}`}
                              style={{ width: labelWidth }}
                              className="truncate px-2 pt-1.5 pb-0.5 text-[10px] font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400"
                              title={b.boardName}
                            >
                              {b.boardName}
                            </div>,
                            ...b.groups.flatMap((g) => [
                              <div
                                key={`group-${b.boardId}-${g.groupId}`}
                                style={{ width: labelWidth }}
                                className="truncate px-2 pl-4 py-0.5 text-[10px] text-neutral-400 dark:text-neutral-500"
                                title={g.groupName}
                              >
                                {g.groupName || "(未分組)"}
                              </div>,
                              ...g.tasks.map((t) => {
                            const hasRange = t.startDate && t.endDate;
                            const startIdx = hasRange ? weekIndexForDate(t.startDate!, weeks) : 0;
                            const endIdx = hasRange ? weekIndexForDate(t.endDate!, weeks) : 0;
                            return (
                              <div key={`${t.boardId}-${t.itemId}`} className="flex items-center">
                                <div
                                  style={{ width: labelWidth }}
                                  className="shrink-0 truncate border-r border-neutral-100 dark:border-neutral-700 py-1 pl-6 pr-2 text-xs text-neutral-600 dark:text-neutral-400"
                                  title={t.itemName}
                                >
                                  <Link
                                    href={`/boards/${t.boardId}?highlight=${t.itemId}`}
                                    className="hover:text-blue-600"
                                  >
                                    {t.itemName}
                                  </Link>
                                </div>
                                <div className="relative flex items-center" style={{ width: timelineWidth, height: 18 }}>
                                  {canCreateSubtask ? (
                                    <button
                                      type="button"
                                      disabled={openingItemId === t.itemId}
                                      onClick={() => openTask(t.itemId)}
                                      title="點選查看時程並調整百分比"
                                      className={`flex h-3.5 items-center justify-center overflow-hidden rounded-sm text-[9px] font-medium text-white hover:ring-1 hover:ring-blue-400 disabled:opacity-60 ${
                                        hasRange ? "absolute top-0.5" : "px-1.5"
                                      }`}
                                      style={{
                                        left: hasRange ? startIdx * WEEK_WIDTH : undefined,
                                        width: hasRange ? (endIdx - startIdx + 1) * WEEK_WIDTH : undefined,
                                        backgroundColor: colorForPct(t.allocationPct, threshold),
                                      }}
                                    >
                                      {t.allocationPct}%
                                    </button>
                                  ) : (
                                    hasRange && (
                                      <div
                                        className="absolute top-0.5 flex h-3.5 items-center justify-center overflow-hidden rounded-sm text-[9px] font-medium text-white"
                                        style={{
                                          left: startIdx * WEEK_WIDTH,
                                          width: (endIdx - startIdx + 1) * WEEK_WIDTH,
                                          backgroundColor: colorForPct(t.allocationPct, threshold),
                                        }}
                                        title={`${t.allocationPct}%`}
                                      >
                                        {t.allocationPct}%
                                      </div>
                                    )
                                  )}
                                </div>
                              </div>
                                );
                              }),
                            ]),
                          ])
                        )}

                        {canCreateSubtask && parentTaskTree.length > 0 && (
                          isCreating ? (
                            <>
                              <div className="flex items-center">
                                <div
                                  style={{ width: labelWidth }}
                                  className="shrink-0 border-r border-neutral-100 dark:border-neutral-700 px-2 py-1 text-[10px] text-neutral-500 dark:text-neutral-400"
                                >
                                  拖曳或點選,亦可於下方輸入
                                </div>
                                <div className="relative flex">
                                  {weeks.map((w, i) => {
                                    const inRange =
                                      rangeStartDays !== null &&
                                      rangeEndDays !== null &&
                                      i * 7 + 6 >= rangeStartDays &&
                                      i * 7 <= rangeEndDays;
                                    return (
                                      <button
                                        key={i}
                                        type="button"
                                        onPointerDown={() => handleWeekPointerDown(user.id, i)}
                                        onPointerEnter={() => handleWeekPointerEnter(user.id, i)}
                                        className={w.isMonthStart ? "border-l border-neutral-200 dark:border-neutral-700" : ""}
                                        style={{
                                          width: WEEK_WIDTH,
                                          height: 20,
                                          backgroundColor: inRange ? "#579bfc" : "#f3f4f6",
                                          cursor: "pointer",
                                          touchAction: "none",
                                        }}
                                      />
                                    );
                                  })}
                                  {rangeStartDays !== null && (
                                    <div
                                      className="pointer-events-none absolute top-0 whitespace-nowrap text-[10px] font-medium text-neutral-700 dark:text-neutral-100"
                                      style={{
                                        left: rangeLeftPx - 6,
                                        transform: "translateX(-100%)",
                                        height: 20,
                                        lineHeight: "20px",
                                      }}
                                    >
                                      {formStartDate}~{formEndDate}・{formDays}天・{formPct}%
                                    </div>
                                  )}
                                </div>
                              </div>

                              <div className="border-t border-neutral-100 dark:border-neutral-700 bg-blue-50/40 dark:bg-blue-950/40 px-2 py-2">
                                {formError && (
                                  <p className="mb-1.5 text-xs text-red-600">{formError}</p>
                                )}
                                {(formMinDate || formMaxDate) && (
                                  <p className="mb-1.5 text-xs text-neutral-400 dark:text-neutral-500">
                                    時程需介於父任務的 {formMinDate ?? "…"} ~ {formMaxDate ?? "…"} 之間
                                  </p>
                                )}
                                {projectedMax > 100 && (
                                  <p className="mb-1.5 text-xs text-amber-600">
                                    ⚠ 此區間 {user.name} 已有 {existingLoad}% 負載,加上此任務 {formPct}%
                                    後最高將達 {projectedMax}%(超過 100%)
                                  </p>
                                )}
                                <div className="flex flex-wrap items-center gap-2">
                                  <ParentTaskPicker
                                    tree={parentTaskTree}
                                    value={formParentId}
                                    onChange={setFormParentId}
                                  />
                                  <input
                                    value={formName}
                                    onChange={(e) => setFormName(e.target.value)}
                                    placeholder="任務名稱(留空預設為「新任務」)"
                                    maxLength={20}
                                    className="w-40 rounded-md border border-neutral-300 dark:border-neutral-600 dark:bg-neutral-900 px-2 py-1 text-xs outline-none focus:border-blue-500"
                                  />
                                </div>
                                <div className="mt-1.5 flex flex-wrap items-center gap-3">
                                  <label className="flex items-center gap-1 text-[10px] text-neutral-500 dark:text-neutral-400">
                                    起始
                                    <input
                                      type="date"
                                      value={formStartDate}
                                      min={formMinDate}
                                      max={formMaxDate}
                                      onChange={(e) => setFormStartDate(e.target.value)}
                                      className="rounded-md border border-neutral-300 dark:border-neutral-600 dark:bg-neutral-900 px-1.5 py-1 text-xs outline-none focus:border-blue-500"
                                    />
                                  </label>
                                  <label className="flex items-center gap-1 text-[10px] text-neutral-500 dark:text-neutral-400">
                                    結束
                                    <input
                                      type="date"
                                      value={formEndDate}
                                      min={formMinDate}
                                      max={formMaxDate}
                                      onChange={(e) => handleEndDateChange(e.target.value)}
                                      className="rounded-md border border-neutral-300 dark:border-neutral-600 dark:bg-neutral-900 px-1.5 py-1 text-xs outline-none focus:border-blue-500"
                                    />
                                  </label>
                                  <label className="flex items-center gap-1 text-[10px] text-neutral-500 dark:text-neutral-400">
                                    天數
                                    <input
                                      type="number"
                                      min={1}
                                      value={formDays}
                                      onChange={(e) => handleDaysChange(Number(e.target.value))}
                                      className="w-14 rounded-md border border-neutral-300 dark:border-neutral-600 dark:bg-neutral-900 px-1.5 py-1 text-xs outline-none focus:border-blue-500"
                                    />
                                  </label>
                                  <label className="flex items-center gap-1 text-[10px] text-neutral-500 dark:text-neutral-400">
                                    百分比
                                    <input
                                      type="number"
                                      min={1}
                                      max={100}
                                      value={formPct}
                                      onChange={(e) => setFormPct(Number(e.target.value))}
                                      className="w-14 rounded-md border border-neutral-300 dark:border-neutral-600 dark:bg-neutral-900 px-1.5 py-1 text-xs outline-none focus:border-blue-500"
                                    />
                                  </label>
                                  <button
                                    type="button"
                                    disabled={submitting}
                                    onClick={() => handleCreate(user.id)}
                                    className="rounded-md bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                                  >
                                    {submitting ? "建立中..." : "建立"}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={resetCreating}
                                    className="rounded-md border border-neutral-300 dark:border-neutral-600 px-3 py-1 text-xs text-neutral-600 dark:text-neutral-400 hover:bg-neutral-50 dark:hover:bg-neutral-800"
                                  >
                                    取消
                                  </button>
                                </div>
                              </div>
                            </>
                          ) : (
                            <button
                              type="button"
                              onClick={() => startCreating(user.id)}
                              className="flex items-center gap-1 px-2 py-1 text-xs text-blue-600 hover:text-blue-700"
                            >
                              <Plus size={12} /> 新增任務
                            </button>
                          )
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
        </>
      )}

      <AssignmentModal
        boardId={scheduleContext?.item.boardId ?? ""}
        item={scheduleContext?.item ?? null}
        users={allUsers}
        currentUserId={currentUserId}
        userRole={userRole}
        open={scheduleContext !== null}
        onOpenChange={(open) => !open && setScheduleContext(null)}
        columns={scheduleContext?.columns}
        predColumnId={scheduleContext?.predColumnId}
        linkColumnId={scheduleContext?.linkColumnId}
        lagColumnId={scheduleContext?.lagColumnId}
        durationColumnId={scheduleContext?.durationColumnId}
        manualStartColumnId={scheduleContext?.manualStartColumnId}
        ganttStartColumnId={scheduleContext?.ganttStartColumnId}
        ganttEndColumnId={scheduleContext?.ganttEndColumnId}
        canEditSchedule={scheduleContext?.canEditSchedule ?? false}
        groupItems={scheduleContext?.groupItems}
        onScheduleApplied={reloadOpenTask}
      />
    </section>
  );
}
