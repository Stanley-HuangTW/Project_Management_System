"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ChevronDown,
  ChevronRight,
  Star,
  MessageSquare,
  UserPlus,
  Plus,
  ArrowUpToLine,
  ArrowDownToLine,
  Trash2,
  Zap,
  Share2,
  Maximize2,
  Minimize2,
} from "lucide-react";
import type { BoardWithData, ItemData, UserOption } from "@/types/board";
import type { GanttDurationMode, Holiday, UserRole } from "@prisma/client";
import { canManageGroupStructure, canEditGanttItem, canModifyItemSchedule } from "@/lib/permissions";
import { resolveGroupRoleAccess, groupDisciplineTeamUserIds, type GroupRoleAccess } from "@/lib/groupRoles";
import { isItemAssignedToUser, isItemAssignedToTeam } from "@/lib/itemAssignment";
import {
  computeRolledUpDateRange,
  computeDailyLoadByUser,
  hasOwnScheduleRule,
  manualScheduleHint as buildManualScheduleHint,
  type DateRange,
} from "@/lib/gantt";
import { countDaysInRange, endFromStartAndDays } from "@/lib/workday";
import { resolveLockedScheduleFields, buildWbsIndexFromItems, resolvePredValues } from "@/lib/predecessorLink";
import { resolvePredLamps } from "@/lib/predLamp";
import { resolveBaselineVariance } from "@/lib/baseline";
import { computeCriticalPath, type ScheduleFloat } from "@/lib/criticalPath";
import { buildDependencyArrows, type BarBox } from "@/lib/ganttArrows";
import type { RelationshipType } from "@/lib/predecessorLink";

const RELATIONSHIP_LABELS = ["FS", "FF", "SS", "SF"];
import { computeWbsCodes } from "@/lib/wbs";
import { resizeItemBar, moveItemBar } from "@/lib/actions/ganttResize";
import { previewDragCascade } from "@/lib/actions/predecessorSchedule";
import type { CascadedItem } from "@/lib/predecessorLink";
import { getStatusOptions } from "@/types/column";
import { computeVisibleItemIds, type ActiveFilter } from "@/lib/filter";
import { useDialogs } from "@/components/ui/DialogProvider";
import { resolveItemNameColor, resolveStatusColumn } from "@/lib/dashboard";
import { AssignmentModal } from "./AssignmentModal";
import { ItemDetailModal } from "./ItemDetailModal";
import { FilterBar } from "./FilterBar";
import { SavedViewBar } from "./SavedViewBar";
import { createItem, insertItem } from "@/lib/actions/item";
import { RowMenu, RowMenuItem } from "@/components/ui/RowMenu";
import { useDeleteItem } from "./useDeleteItem";

type Zoom = "day" | "week" | "month";
const ZOOM_DAY_WIDTH: Record<Zoom, number> = { day: 34, week: 10, month: 3 };
const DEFAULT_LABEL_WIDTH = 260;
const MIN_LABEL_WIDTH = 140;
const MAX_LABEL_WIDTH = 560;

type HeaderSegment = { key: string; label: string; sublabel?: string; days: number };

/** ISO-8601 week number (1-53) — the week containing the year's first
 *  Thursday is week 1. */
function isoWeekNumber(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

/** ISO date of the Monday starting `date`'s week — used to detect a new
 *  week bucket by comparing dates directly instead of checking for a
 *  literal Monday, since business-day mode can omit the Monday itself
 *  (holiday) from `days` entirely. */
function mondayOfWeek(date: Date): string {
  const day = date.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  const monday = new Date(date);
  monday.setDate(monday.getDate() + diff);
  return toIsoDate(monday);
}

function buildHeaderSegments(days: Date[], zoom: Zoom): HeaderSegment[] {
  if (zoom === "day") {
    return days.map((d) => ({ key: toIsoDate(d), label: formatDay(d), days: 1 }));
  }
  const segments: HeaderSegment[] = [];
  let bucket: Date[] = [];
  function flush() {
    if (bucket.length === 0) return;
    const start = bucket[0];
    segments.push({
      key: toIsoDate(start),
      label: zoom === "week" ? formatDay(start) : `${start.getFullYear()}/${start.getMonth() + 1}`,
      sublabel: zoom === "week" ? `第${isoWeekNumber(start)}週` : undefined,
      days: bucket.length,
    });
    bucket = [];
  }
  for (const d of days) {
    const last = bucket[bucket.length - 1];
    // Compare actual calendar boundaries against the bucket's own last day,
    // not a literal "is this the 1st/a Monday" check — business-day mode
    // can skip that exact date (weekend/holiday) entirely, which silently
    // merged the whole following month/week into the wrong bucket.
    const startsNewBucket =
      last !== undefined &&
      (zoom === "week"
        ? mondayOfWeek(d) !== mondayOfWeek(last)
        : d.getFullYear() !== last.getFullYear() || d.getMonth() !== last.getMonth());
    if (startsNewBucket) flush();
    bucket.push(d);
  }
  flush();
  return segments;
}
const ASSIGNEE_COLORS = [
  "#579bfc",
  "#00c875",
  "#fdab3d",
  "#e2445c",
  "#a25ddc",
  "#66ccff",
  "#ff642e",
  "#037f4c",
];

function colorForUser(userId: string, users: UserOption[]) {
  const idx = users.findIndex((u) => u.id === userId);
  return ASSIGNEE_COLORS[(idx < 0 ? 0 : idx) % ASSIGNEE_COLORS.length];
}

function toIsoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function isWeekendDay(date: Date) {
  const day = date.getDay();
  return day === 0 || day === 6;
}

function formatDay(date: Date) {
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

export function BoardGantt({
  board,
  users,
  userRole,
  currentUserId,
  holidays,
  onNavigateToItem,
  active = true,
}: {
  board: BoardWithData;
  users: UserOption[];
  userRole: UserRole;
  currentUserId: string;
  holidays: Holiday[];
  onNavigateToItem?: (itemId: string) => void;
  /** False while another view is showing. BoardView keeps this mounted so the
   *  zoom, scale, filters and collapsed rows survive a trip to the table;
   *  hiding it is display:none, which drops the scroll offsets, so those are
   *  put back when it comes into view again. */
  active?: boolean;
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const requestDelete = useDeleteItem();
  const [assignmentItem, setAssignmentItem] = useState<ItemData | null>(null);
  const [detailItem, setDetailItem] = useState<ItemData | null>(null);
  const [detailInitialTab, setDetailInitialTab] = useState<"updates" | "card">("updates");
  const [zoom, setZoom] = useState<Zoom>("day");
  const [filters, setFilters] = useState<ActiveFilter[]>([]);
  const [groupFilterId, setGroupFilterId] = useState("");
  const [parentFilterId, setParentFilterId] = useState("");
  const [labelWidth, setLabelWidth] = useState(DEFAULT_LABEL_WIDTH);
  const [scalePct, setScalePct] = useState(100);
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    if (!isFullscreen) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setIsFullscreen(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isFullscreen]);

  function startLabelResize(e: React.PointerEvent) {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = labelWidth;
    function onMove(ev: PointerEvent) {
      const next = Math.min(MAX_LABEL_WIDTH, Math.max(MIN_LABEL_WIDTH, startWidth + (ev.clientX - startX)));
      setLabelWidth(next);
    }
    function onUp() {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }
  const durationMode = board.ganttDurationMode;
  const isBusinessMode = durationMode === "BUSINESS";
  const holidaySet = useMemo(() => new Set(holidays.map((h) => h.date)), [holidays]);
  const holidayNameByDate = useMemo(() => new Map(holidays.map((h) => [h.date, h.name])), [holidays]);
  function isHoliday(d: Date) {
    return holidaySet.has(toIsoDate(d));
  }
  /** Weekend/holiday tint for a day column — both are removed from the
   *  timeline entirely in BUSINESS mode (see `days` below), so this only
   *  ever paints them in CALENDAR mode, where every calendar day is shown. */
  function dayShade(d: Date): string | undefined {
    if (isHoliday(d)) return "#fde2e2";
    if (isWeekendDay(d)) return "#e9ecef";
    return undefined;
  }
  const dayWidth = ZOOM_DAY_WIDTH[zoom];
  const scrollRef = useRef<HTMLDivElement>(null);
  const topScrollRef = useRef<HTMLDivElement>(null);
  const dragState = useRef<{ startX: number; startScrollLeft: number } | null>(null);
  const lastScroll = useRef<{ left: number; top: number } | null>(null);
  const [isPanning, setIsPanning] = useState(false);
  const today = useMemo(() => new Date(new Date().toISOString().slice(0, 10)), []);

  function syncFromTopScroll() {
    if (scrollRef.current && topScrollRef.current) {
      scrollRef.current.scrollLeft = topScrollRef.current.scrollLeft;
    }
  }

  function syncFromMainScroll() {
    const el = scrollRef.current;
    if (!el) return;
    // Recorded on every scroll rather than read when hiding: by then the chart
    // is already display:none and reports 0 for both offsets.
    lastScroll.current = { left: el.scrollLeft, top: el.scrollTop };
    if (topScrollRef.current) topScrollRef.current.scrollLeft = el.scrollLeft;
  }

  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    const container = scrollRef.current;
    if (!container) return;
    // A React portal (a row's "+" menu, and anything it opens) sits outside
    // this container in the DOM but still bubbles its events up the React
    // tree, so its pointerdown arrives here. Capturing the pointer then sends
    // the pointerup to this container instead of the menu — and a menu item
    // that never sees a pointerup never registers the choice, so the menu just
    // sat there doing nothing.
    if (!container.contains(e.target as Node)) return;
    if ((e.target as HTMLElement).closest("button")) return;
    dragState.current = { startX: e.clientX, startScrollLeft: container.scrollLeft };
    setIsPanning(true);
    container.setPointerCapture(e.pointerId);
  }

  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!dragState.current || !scrollRef.current) return;
    scrollRef.current.scrollLeft = dragState.current.startScrollLeft - (e.clientX - dragState.current.startX);
    syncFromMainScroll();
  }

  function handlePointerUp(e: React.PointerEvent<HTMLDivElement>) {
    dragState.current = null;
    setIsPanning(false);
    scrollRef.current?.releasePointerCapture(e.pointerId);
  }

  const startColumnId = board.ganttStartColumnId;
  const durationColumnId = board.ganttDurationColumnId;
  const endColumnId = board.ganttEndColumnId;
  const predColumnId = board.predColumnId;
  const linkColumnId = board.linkColumnId;
  const lagColumnId = board.lagColumnId;
  const typeColumnId = board.typeColumnId;

  const lockedScheduleFields = useMemo(() => {
    const linkColumn = board.columns.find((c) => c.id === linkColumnId);
    const typeColumn = board.columns.find((c) => c.id === typeColumnId);
    return resolveLockedScheduleFields(
      board.items,
      predColumnId,
      linkColumnId,
      linkColumn?.options,
      typeColumnId,
      typeColumn?.options,
      board.manualStartColumnId,
      board.manualDurationColumnId
    );
  }, [
    board.items,
    board.columns,
    predColumnId,
    linkColumnId,
    typeColumnId,
    board.manualStartColumnId,
    board.manualDurationColumnId,
  ]);

  // Dragging is governed by what actually decides the dates, not by the
  // blanket lock: with 手動開始日期/天數 configured, Start/Days/Finish are
  // outputs for every item, but start(set)/duration remain editable — so a
  // drag is still meaningful and ganttResize writes those instead. Only a
  // Pred, a child rollup, or a Milestone genuinely rules a drag out.
  const wbsIndex = useMemo(() => buildWbsIndexFromItems(board.items), [board.items]);
  const ruleColumns = useMemo(
    () => ({ predColumnId, manualStartColumnId: board.manualStartColumnId }),
    [predColumnId, board.manualStartColumnId]
  );

  // Nothing to draw against until a plan has actually been saved.
  const showBaseline = board.baselineCapturedAt !== null;

  // Total float per item, from the CPM backward pass. Computed per group,
  // since a Pred chain never crosses one.
  const [showCriticalPath, setShowCriticalPath] = useState(false);
  const [showArrows, setShowArrows] = useState(true);
  const scheduleFloats = useMemo(() => {
    const merged = new Map<string, ScheduleFloat>();
    const linkColumn = board.columns.find((c) => c.id === board.linkColumnId);
    const holidaySet = new Set(holidays.map((h) => h.date));
    const byGroup = new Map<string, ItemData[]>();
    for (const item of board.items) {
      byGroup.set(item.groupId, [...(byGroup.get(item.groupId) ?? []), item]);
    }
    for (const groupItems of byGroup.values()) {
      const floats = computeCriticalPath(
        groupItems,
        {
          predColumnId: board.predColumnId,
          linkColumnId: board.linkColumnId,
          linkColumnOptions: linkColumn?.options,
          lagColumnId: board.lagColumnId,
          startColumnId: board.ganttStartColumnId,
          durationColumnId: board.ganttDurationColumnId,
          durationMode: board.ganttDurationMode,
        },
        holidaySet
      );
      for (const [id, value] of floats) merged.set(id, value);
    }
    return merged;
  }, [board, holidays]);
  const criticalCount = useMemo(
    () => [...scheduleFloats.values()].filter((f) => f.isCritical).length,
    [scheduleFloats]
  );

  // Where each row's bar actually landed. Measured rather than derived: rows
  // are interleaved with group headers, collapsed subtrees drop out, and the
  // display-scale zoom rescales everything — the DOM already knows all of it.
  const contentRef = useRef<HTMLDivElement>(null);
  const [barBoxes, setBarBoxes] = useState<Map<string, BarBox>>(new Map());

  const measureBars = useCallback(() => {
    const container = contentRef.current;
    if (!container) return;
    const origin = container.getBoundingClientRect();
    const next = new Map<string, BarBox>();
    for (const cell of container.querySelectorAll<HTMLElement>("[data-gantt-row]")) {
      const id = cell.dataset.ganttRow;
      const bar = cell.querySelector<HTMLElement>("[data-gantt-bar]");
      if (!id || !bar) continue;
      const rect = bar.getBoundingClientRect();
      next.set(id, {
        left: rect.left - origin.left,
        right: rect.right - origin.left,
        centerY: rect.top + rect.height / 2 - origin.top,
      });
    }
    setBarBoxes((prev) => (sameBoxes(prev, next) ? prev : next));
  }, []);

  // No dependency list: any render can move a row (a collapse, a filter, a
  // drag that lands). Re-measuring is cheap and setBarBoxes bails when nothing
  // moved, so this settles after one pass instead of looping.
  useLayoutEffect(measureBars);


  // A lamp beside the Pred field in both modals, coloured by what the
  // PREDECESSOR's own state means for the item that depends on it.
  const predLamps = useMemo(
    () => resolvePredLamps(board.items, board, new Set(holidays.map((h) => h.date))),
    [board, holidays]
  );

  const dragLocks = useMemo(() => {
    const linkColumn = board.columns.find((c) => c.id === linkColumnId);
    const typeColumn = board.columns.find((c) => c.id === typeColumnId);
    return resolveLockedScheduleFields(
      board.items,
      predColumnId,
      linkColumnId,
      linkColumn?.options,
      typeColumnId,
      typeColumn?.options,
      undefined,
      undefined,
      board.manualStartColumnId
    );
  }, [board.items, board.columns, predColumnId, linkColumnId, typeColumnId, board.manualStartColumnId]);

  const typeOptions = useMemo(() => {
    const typeColumn = board.columns.find((c) => c.id === typeColumnId);
    return getStatusOptions(typeColumn?.options);
  }, [board.columns, typeColumnId]);

  function isMilestone(item: ItemData): boolean {
    if (!typeColumnId) return false;
    const value = item.cellValues.find((cv) => cv.columnId === typeColumnId)?.value;
    return typeOptions.find((o) => o.id === value)?.label === "Milestone";
  }

  const ranges = useMemo(() => {
    const map = new Map<string, DateRange>();
    if (!startColumnId || !durationColumnId) return map;
    for (const item of board.items) {
      const range = computeRolledUpDateRange(
        item,
        board.items,
        startColumnId,
        durationColumnId,
        durationMode,
        holidaySet,
        { predColumnId: board.predColumnId, manualStartColumnId: board.manualStartColumnId }
      );
      if (!range) continue;
      map.set(item.id, isMilestone(item) ? { start: range.start, end: range.start } : range);
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [board.items, startColumnId, durationColumnId, durationMode, holidaySet, typeColumnId, typeOptions]);

  // Task-name color by status — 完成 beats 逾期 beats 實作中 (an item that's
  // both done and past its own end date still just reads as done); 尚未處理
  // gets no override, just the theme's normal text color. 完成/逾期 are date-
  // and-progress driven (same definition the dashboard's overdue/upcoming
  // cards already use); 實作中 is whatever the Status column itself says —
  // matched by the option's label, not its id, since imported boards give
  // their Status options random ids (only the label "In Progress" is stable).
  const ganttStatusColumn = useMemo(() => resolveStatusColumn(board), [board]);
  function ganttStatusColor(item: ItemData): string | undefined {
    return resolveItemNameColor(item, board, ganttStatusColumn, ranges.get(item.id) ?? null);
  }

  const days = useMemo(() => {
    if (ranges.size === 0) return [] as Date[];
    let min = Infinity;
    let max = -Infinity;
    for (const { start, end } of ranges.values()) {
      min = Math.min(min, start.getTime());
      max = Math.max(max, end.getTime());
    }
    // Always include today, so the timeline can be scrolled to it even if no
    // item currently spans it.
    min = Math.min(min, today.getTime());
    max = Math.max(max, today.getTime());
    const minD = new Date(min);
    const totalDays = Math.round((max - min) / 86400000) + 1;
    const list: Date[] = [];
    for (let i = 0; i < totalDays; i++) {
      const d = new Date(minD);
      d.setDate(d.getDate() + i);
      // In business mode a weekend or holiday takes up no width at all — the
      // timeline jumps straight to the next working day.
      if (isBusinessMode && (isWeekendDay(d) || holidaySet.has(toIsoDate(d)))) continue;
      list.push(d);
    }
    return list;
  }, [ranges, today, isBusinessMode, holidaySet]);

  const dayIndexByIso = useMemo(() => new Map(days.map((d, i) => [toIsoDate(d), i])), [days]);
  /** Column index for a date that may itself have been filtered out of
   *  `days` (e.g. today falling on a hidden holiday) — falls back to the
   *  count of visible days strictly before it. */
  function indexForDate(d: Date): number {
    const exact = dayIndexByIso.get(toIsoDate(d));
    if (exact !== undefined) return exact;
    let idx = 0;
    for (const day of days) {
      if (day.getTime() < d.getTime()) idx++;
      else break;
    }
    return idx;
  }

  const headerSegments = useMemo(() => buildHeaderSegments(days, zoom), [days, zoom]);
  const todayIndex = days.length > 0 ? indexForDate(today) : -1;

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || todayIndex < 0) return;
    // Today near the left edge (a couple of days' lead-in for context) rather
    // than centered, so the default view opens onto upcoming work.
    el.scrollLeft = Math.max(0, (todayIndex - 2) * dayWidth);
    syncFromMainScroll();
    // Only re-scroll when the zoom level or the underlying day range changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom, days.length]);

  // Coming back from another view: display:none dropped the scroll offsets, so
  // put back where the chart was rather than snapping to today again.
  useEffect(() => {
    const el = scrollRef.current;
    const saved = lastScroll.current;
    if (!active || !el || !saved) return;
    el.scrollLeft = saved.left;
    el.scrollTop = saved.top;
    if (topScrollRef.current) topScrollRef.current.scrollLeft = saved.left;
  }, [active]);

  const contentWidth = labelWidth + days.length * dayWidth;

  const personColumnIds = useMemo(
    () => board.columns.filter((c) => c.type === "PERSON").map((c) => c.id),
    [board.columns]
  );

  const dailyLoad = useMemo(() => {
    if (!startColumnId || !durationColumnId) return new Map<string, Map<string, number>>();
    return computeDailyLoadByUser(
      board.items,
      startColumnId,
      durationColumnId,
      personColumnIds,
      durationMode,
      holidaySet
    );
  }, [board.items, startColumnId, durationColumnId, personColumnIds, durationMode, holidaySet]);

  const usersWithLoad = users.filter((u) => (dailyLoad.get(u.id)?.size ?? 0) > 0);

  const itemById = useMemo(() => new Map(board.items.map((i) => [i.id, i])), [board.items]);

  const visibleIds = useMemo(() => {
    let ids = computeVisibleItemIds(board.items, filters);
    if (groupFilterId) {
      const groupIds = new Set(board.items.filter((i) => i.groupId === groupFilterId).map((i) => i.id));
      ids = ids ? new Set([...ids].filter((id) => groupIds.has(id))) : groupIds;
    }
    if (parentFilterId) {
      const subtree = new Set<string>();
      const collect = (id: string) => {
        subtree.add(id);
        for (const child of board.items) {
          if (child.parentId === id) collect(child.id);
        }
      };
      collect(parentFilterId);
      ids = ids ? new Set([...ids].filter((id) => subtree.has(id))) : subtree;
    }
    return ids;
  }, [board.items, filters, groupFilterId, parentFilterId]);

  const teamUserIds = useMemo(
    () => new Set(users.filter((u) => u.supervisorId === currentUserId).map((u) => u.id)),
    [users, currentUserId]
  );

  const myGroupAccessByGroupId = useMemo(() => {
    const map = new Map<string, GroupRoleAccess>();
    for (const g of board.groups) {
      map.set(g.id, resolveGroupRoleAccess(g.roleAssignments.filter((a) => a.userId === currentUserId)));
    }
    return map;
  }, [board.groups, currentUserId]);

  const groupTeamUserIdsByGroupId = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const g of board.groups) {
      const access = myGroupAccessByGroupId.get(g.id);
      map.set(g.id, access ? groupDisciplineTeamUserIds(g.members, access) : new Set());
    }
    return map;
  }, [board.groups, myGroupAccessByGroupId]);

  function canEditItem(item: ItemData): boolean {
    const access = myGroupAccessByGroupId.get(item.groupId);
    const groupTeamUserIds = groupTeamUserIdsByGroupId.get(item.groupId);
    return canEditGanttItem(
      userRole,
      isItemAssignedToUser(item, personColumnIds, currentUserId),
      isItemAssignedToTeam(item, personColumnIds, teamUserIds) ||
        (!!groupTeamUserIds && isItemAssignedToTeam(item, personColumnIds, groupTeamUserIds)),
      access?.hasScheduleRole ?? false
    );
  }

  // Deliberately stricter than canEditItem (which also allows the item's own
  // assignee, or a supervisor over that assignee, to open the assignment
  // modal): dragging/resizing the bar — and the Pred/Link/Lag fields inside
  // that modal — is schedule editing, so it follows the same rule cell.ts
  // already applies to typing a new Start/Days/Finish directly.
  function canEditItemSchedule(item: ItemData): boolean {
    const access = myGroupAccessByGroupId.get(item.groupId);
    return canModifyItemSchedule(userRole, item.createdById, currentUserId, access?.hasScheduleRole ?? false);
  }

  function canEditItemStructure(item: ItemData): boolean {
    const access = myGroupAccessByGroupId.get(item.groupId);
    return canManageGroupStructure(userRole, (access?.disciplines.size ?? 0) > 0);
  }

  // WBS codes numbered per Group (each group's own top-level items restart
  // at "1") to match what the table shows — computeWbsCodes itself treats
  // whatever list it's given as one flat tree, so it must be called once per
  // group and merged, not once across board.items (which would let one
  // group's numbering bleed into another's, same bug as Pred/Link matching).
  const wbsCodes = useMemo(() => {
    const map = new Map<string, string>();
    for (const group of board.groups) {
      const groupItems = board.items.filter((i) => i.groupId === group.id);
      for (const [id, code] of computeWbsCodes(groupItems)) map.set(id, code);
    }
    return map;
  }, [board.items, board.groups]);

  const linkOptions = useMemo(
    () => getStatusOptions(board.columns.find((c) => c.id === linkColumnId)?.options),
    [board.columns, linkColumnId]
  );

  /** This item's Link, as a relationship type — null when it isn't set to one. */
  function linkRelationship(item: ItemData): RelationshipType | null {
    if (!linkColumnId) return null;
    const value = item.cellValues.find((cv) => cv.columnId === linkColumnId)?.value;
    const label = linkOptions.find((o) => o.id === value)?.label;
    return label && (RELATIONSHIP_LABELS as string[]).includes(label)
      ? (label as RelationshipType)
      : null;
  }

  // One arrow per dependency, drawn between the two bars as measured. A link
  // whose ends are not both on screen — a collapsed subtree, a filtered row,
  // an item with no dates — simply has nothing to draw between.
  const dependencyArrows = useMemo(() => {
    if (!showArrows || !predColumnId || !linkColumnId) return [];
    const links: Parameters<typeof buildDependencyArrows>[0] = [];
    for (const item of board.items) {
      const relationship = linkRelationship(item);
      if (!relationship) continue;
      const predValue = item.cellValues.find((cv) => cv.columnId === predColumnId)?.value;
      for (const predId of resolvePredValues(wbsIndex, item.groupId, predValue)) {
        const predItem = itemById.get(predId);
        if (!predItem) continue;
        links.push({
          predId,
          succId: item.id,
          relationship,
          // An arrow is on the critical path only when both ends are.
          critical:
            (scheduleFloats.get(predId)?.isCritical ?? false) &&
            (scheduleFloats.get(item.id)?.isCritical ?? false),
          title: `${wbsCodes.get(predId) ?? ""} ${predItem.name} → ${wbsCodes.get(item.id) ?? ""} ${item.name}(${relationship})`,
        });
      }
    }
    return buildDependencyArrows(links, barBoxes);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showArrows, board.items, predColumnId, linkColumnId, linkOptions, wbsIndex, itemById, wbsCodes, scheduleFloats, barBoxes]);

  const itemsByParent = new Map<string | null, ItemData[]>();
  for (const item of board.items) {
    if (visibleIds !== null && !visibleIds.has(item.id)) continue;
    const list = itemsByParent.get(item.parentId) ?? [];
    list.push(item);
    itemsByParent.set(item.parentId, list);
  }
  for (const list of itemsByParent.values()) {
    list.sort((a, b) => a.order - b.order);
  }
  const renderRootParentId = parentFilterId ? (itemById.get(parentFilterId)?.parentId ?? null) : null;

  // Top-level rows are split per 分組 — WBS codes restart at "1" inside each
  // group, so rendering every group's roots as one flat list produced two
  // "1.1.1"s with nothing to tell them apart. Groups with nothing visible
  // under the current filters drop out entirely, header included.
  const groupSections = board.groups
    .map((group) => ({
      group,
      roots: (itemsByParent.get(renderRootParentId) ?? []).filter((i) => i.groupId === group.id),
      visibleCount: board.items.filter(
        (i) => i.groupId === group.id && (visibleIds === null || visibleIds.has(i.id))
      ).length,
    }))
    .filter((section) => section.roots.length > 0);

  function toggleCollapsed(itemId: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  }

  async function handleAddSubitem(item: ItemData) {
    setCollapsed((prev) => {
      if (!prev.has(item.id)) return prev;
      const next = new Set(prev);
      next.delete(item.id);
      return next;
    });
    const created = await createItem(board.id, item.groupId, "新子項目", item.id);
    setDetailInitialTab("card");
    setDetailItem(created);
  }

  async function handleInsert(item: ItemData, position: "before" | "after") {
    const created = await insertItem(board.id, item.groupId, item.parentId, item.id, position);
    setDetailInitialTab("card");
    setDetailItem(created);
  }

  // Both modals hold the item they were opened on, but a schedule edit inside
  // them recomputes Start/Finish server-side and router.refresh()es — so read
  // the refreshed row back out of board.items rather than keep showing the
  // snapshot from the click. Falls back to the snapshot for an item that was
  // just created and hasn't landed in board.items yet.
  const liveAssignmentItem = assignmentItem
    ? (board.items.find((i) => i.id === assignmentItem.id) ?? assignmentItem)
    : null;
  const liveDetailItem = detailItem
    ? (board.items.find((i) => i.id === detailItem.id) ?? detailItem)
    : null;

  const manualScheduleHint = useMemo(
    () =>
      buildManualScheduleHint(board.columns, board.manualStartColumnId, board.manualDurationColumnId),
    [board.columns, board.manualStartColumnId, board.manualDurationColumnId]
  );

  /** Names whatever actually decides this item's dates, so a refused drag can
   *  say which item (or which field) to change instead of just "it's
   *  computed". Returns null when nothing is driving it. */
  function scheduleLockCause(item: ItemData): string | null {
    const children = itemsByParent.get(item.id) ?? [];
    if (children.length > 0 && !hasOwnScheduleRule(item, ruleColumns)) {
      const names = children
        .slice(0, 3)
        .map((c) => `${wbsCodes.get(c.id) ?? ""} ${c.name}`.trim())
        .join("、");
      return `此項目的時程是由子項目統計出來的,要改請改子項目的時間:${names}${children.length > 3 ? " 等" : ""}`;
    }

    if (predColumnId && linkColumnId) {
      const predValue = item.cellValues.find((cv) => cv.columnId === predColumnId)?.value;
      const predItems = resolvePredValues(wbsIndex, item.groupId, predValue)
        .map((predId) => itemById.get(predId))
        .filter((predItem): predItem is ItemData => !!predItem);
      if (predItems.length > 0) {
        const names = predItems
          .map((predItem) => `「${wbsCodes.get(predItem.id) ?? ""} ${predItem.name}」`)
          .join("、");
        return `此項目的時間由前置依賴${names}決定,要提前或延後請改該項目的時間,或改此項目的 Pred / Link / Lag`;
      }
    }

    if (isMilestone(item)) {
      return "里程碑的天數固定為 0,只能改開始日期,無法拉長或縮短";
    }
    return null;
  }

  function renderRows(parentId: string | null, depth: number, siblings?: ItemData[]): ReactNode[] {
    const children = siblings ?? itemsByParent.get(parentId) ?? [];
    return children.flatMap((item) => {
      const hasChildren = (itemsByParent.get(item.id)?.length ?? 0) > 0;
      const isCollapsed = collapsed.has(item.id);
      const range = ranges.get(item.id);
      const nameColor = ganttStatusColor(item);

      const row = (
        <div key={item.id} className="flex items-stretch border-b border-neutral-100 dark:border-neutral-700">
          <div
            className="sticky left-0 z-10 flex shrink-0 items-center gap-1 bg-white dark:bg-neutral-900 px-2 py-1.5 text-sm"
            style={{ width: labelWidth, paddingLeft: 8 + depth * 16 }}
          >
            {hasChildren ? (
              <button
                type="button"
                onClick={() => toggleCollapsed(item.id)}
                className="text-neutral-400 dark:text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-100"
              >
                {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
              </button>
            ) : (
              <span className="w-3.5" />
            )}
            {onNavigateToItem ? (
              <button
                type="button"
                onClick={() => onNavigateToItem(item.id)}
                title="在表格中查看此項目"
                className="min-w-0 flex-1 truncate text-left hover:text-blue-600 hover:underline"
                style={nameColor ? { color: nameColor } : undefined}
              >
                {wbsCodes.get(item.id) && (
                  <span className="mr-1 text-neutral-400 dark:text-neutral-500">{wbsCodes.get(item.id)}</span>
                )}
                {item.name}
              </button>
            ) : (
              <span className="min-w-0 flex-1 truncate" style={nameColor ? { color: nameColor } : undefined}>
                {wbsCodes.get(item.id) && (
                  <span className="mr-1 text-neutral-400 dark:text-neutral-500">{wbsCodes.get(item.id)}</span>
                )}
                {item.name}
              </span>
            )}
            <button
              type="button"
              onClick={() => setDetailItem(item)}
              className={`flex shrink-0 items-center gap-0.5 rounded px-1 py-0.5 text-xs hover:bg-neutral-100 dark:hover:bg-neutral-800 hover:text-neutral-600 dark:hover:text-neutral-400 ${
                item._count.comments > 0 ? "text-blue-600" : "text-neutral-300 dark:text-neutral-600"
              }`}
              aria-label="留言"
            >
              <MessageSquare size={12} />
              {item._count.comments > 0 && <span>{item._count.comments}</span>}
            </button>
            {canEditItemStructure(item) && (
              <button
                type="button"
                onClick={() => setAssignmentItem(item)}
                title={item.assignments.map((a) => `${a.user.name} ${a.allocationPct}%`).join(", ")}
                className={`flex shrink-0 items-center gap-0.5 rounded px-1 py-0.5 text-xs hover:bg-neutral-100 dark:hover:bg-neutral-800 hover:text-neutral-600 dark:hover:text-neutral-400 ${
                  item.assignments.length > 0 ? "text-blue-600" : "text-neutral-300 dark:text-neutral-600"
                }`}
                aria-label="指派"
              >
                <UserPlus size={12} />
                {item.assignments.length > 0 && <span>{item.assignments.length}</span>}
              </button>
            )}
            {(canEditItemStructure(item) || canEditItemSchedule(item)) && (
              // Same actions as the table row's "…", hung off the "+" the row
              // already had — a new item opens straight into its card, so the
              // fields the parent implies are there to check before typing.
              <RowMenu
                label="新增或刪除項目"
                icon={<Plus size={12} />}
                triggerClassName="flex shrink-0 items-center gap-0.5 rounded px-1 py-0.5 text-xs text-neutral-300 dark:text-neutral-600 hover:bg-neutral-100 dark:hover:bg-neutral-800 hover:text-neutral-600 dark:hover:text-neutral-400"
              >
                {canEditItemStructure(item) && (
                  <>
                    <RowMenuItem onSelect={() => handleAddSubitem(item)}>
                      <span className="flex items-center gap-2">
                        <Plus size={14} /> 新增子項目
                      </span>
                    </RowMenuItem>
                    <RowMenuItem onSelect={() => handleInsert(item, "before")}>
                      <span className="flex items-center gap-2">
                        <ArrowUpToLine size={14} /> 上方插入項目
                      </span>
                    </RowMenuItem>
                    <RowMenuItem onSelect={() => handleInsert(item, "after")}>
                      <span className="flex items-center gap-2">
                        <ArrowDownToLine size={14} /> 下方插入項目
                      </span>
                    </RowMenuItem>
                  </>
                )}
                {canEditItemSchedule(item) && (
                  <RowMenuItem danger onSelect={() => requestDelete(board.id, item.id)}>
                    <span className="flex items-center gap-2">
                      <Trash2 size={14} /> 刪除
                    </span>
                  </RowMenuItem>
                )}
              </RowMenu>
            )}
          </div>
          <div
            className="relative shrink-0"
            data-gantt-row={item.id}
            style={{ width: days.length * dayWidth, height: 34 }}
          >
            <div className="absolute inset-0 flex">
              {days.map((d) => (
                <div
                  key={toIsoDate(d)}
                  className="shrink-0"
                  style={{ width: dayWidth, backgroundColor: dayShade(d) ?? "transparent" }}
                />
              ))}
            </div>
            {showBaseline && <BaselineBar item={item} dayIndexByIso={dayIndexByIso} dayWidth={dayWidth} />}
            {range && (
              <GanttBar
                boardId={board.id}
                item={item}
                range={range}
                dayWidth={dayWidth}
                dayIndexByIso={dayIndexByIso}
                days={days}
                users={users}
                durationMode={durationMode}
                holidaySet={holidaySet}
                isMilestone={isMilestone(item)}
                startLocked={dragLocks.get(item.id)?.startLocked ?? false}
                endLocked={dragLocks.get(item.id)?.endLocked ?? false}
                daysLocked={dragLocks.get(item.id)?.daysLocked ?? false}
                lockCause={scheduleLockCause(item)}
                scheduleFloat={scheduleFloats.get(item.id)}
                highlightCritical={showCriticalPath}
                canEdit={canEditItemSchedule(item)}
                onClick={canEditItem(item) ? () => setAssignmentItem(item) : undefined}
              />
            )}
          </div>
        </div>
      );

      if (hasChildren && !isCollapsed) {
        return [row, ...renderRows(item.id, depth + 1)];
      }
      return [row];
    });
  }

  return (
    <div
      className={
        `${active ? "" : "hidden"} ${
          isFullscreen ? "fixed inset-0 z-50 flex flex-col overflow-hidden bg-white dark:bg-neutral-950 p-4" : ""
        }`
      }
    >
      {/* One toolbar row: scale/zoom, the group + parent filters, and the
          fullscreen toggle pinned right — every line saved here is a line the
          chart itself gets to use. */}
      <div className="mb-2 flex shrink-0 flex-wrap items-center gap-2 text-sm">
        <span className="text-neutral-500 dark:text-neutral-400">時間刻度</span>
        <div className="flex overflow-hidden rounded-md border border-neutral-200 dark:border-neutral-700 text-xs">
          {(["day", "week", "month"] as const).map((z) => (
            <button
              key={z}
              type="button"
              onClick={() => setZoom(z)}
              className={`px-2.5 py-1 ${
                zoom === z ? "bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900" : "bg-white dark:bg-neutral-900 text-neutral-600 dark:text-neutral-400 hover:bg-neutral-50 dark:hover:bg-neutral-800"
              }`}
            >
              {z === "day" ? "天" : z === "week" ? "週" : "月"}
            </button>
          ))}
        </div>
        <span className="ml-2 text-neutral-500 dark:text-neutral-400">顯示比例</span>
        <input
          type="range"
          min={50}
          max={150}
          step={5}
          value={scalePct}
          onChange={(e) => setScalePct(Number(e.target.value))}
          className="w-28"
        />
        <span className="w-10 text-xs text-neutral-500 dark:text-neutral-400">{scalePct}%</span>
        <button
          type="button"
          onClick={() => setShowCriticalPath((on) => !on)}
          title={`要徑上的工作項延一天,整個專案就延一天。目前有 ${criticalCount} 項總浮時為 0`}
          className={`ml-2 flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs ${
            showCriticalPath
              ? "border-red-300 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300"
              : "border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 text-neutral-600 dark:text-neutral-400 hover:bg-neutral-50 dark:hover:bg-neutral-800"
          }`}
        >
          <Zap size={13} /> 要徑 {criticalCount > 0 && `(${criticalCount})`}
        </button>
        <button
          type="button"
          onClick={() => setShowArrows((on) => !on)}
          title="在長條之間畫出前置依賴的箭頭"
          className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs ${
            showArrows
              ? "border-blue-300 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-300"
              : "border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 text-neutral-600 dark:text-neutral-400 hover:bg-neutral-50 dark:hover:bg-neutral-800"
          }`}
        >
          <Share2 size={13} /> 相依箭頭
        </button>
        <div className="ml-2 flex items-center gap-2">
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
        </div>
        <div className="flex items-center gap-2">
          <span className="text-neutral-500 dark:text-neutral-400">父項目</span>
          <select
            value={parentFilterId}
            onChange={(e) => setParentFilterId(e.target.value)}
            className="max-w-[200px] rounded-md border border-neutral-300 dark:border-neutral-600 dark:bg-neutral-900 px-2 py-1 text-xs outline-none focus:border-blue-500"
          >
            <option value="">全部</option>
            {board.items.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name}
              </option>
            ))}
          </select>
        </div>
        {(groupFilterId || parentFilterId) && (
          <button
            type="button"
            onClick={() => {
              setGroupFilterId("");
              setParentFilterId("");
            }}
            className="text-xs text-neutral-400 dark:text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-100"
          >
            清除
          </button>
        )}
        <button
          type="button"
          onClick={() => setIsFullscreen((v) => !v)}
          className="ml-auto flex items-center gap-1 rounded-md border border-neutral-300 dark:border-neutral-600 px-2 py-1 text-xs text-neutral-600 dark:text-neutral-400 hover:bg-neutral-50 dark:hover:bg-neutral-800"
        >
          {isFullscreen ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
          {isFullscreen ? "退出全螢幕" : "全螢幕"}
        </button>
      </div>
      <div className="flex shrink-0 flex-wrap items-start justify-between gap-2">
        <FilterBar columns={board.columns} users={users} filters={filters} onChange={setFilters} />
        {/* The Gantt has no name search of its own, so a view saved in the
            table keeps its query but does not apply it here. */}
        <SavedViewBar
          boardId={board.id}
          currentConfig={{ filters, groupFilterId, searchQuery: "" }}
          onApply={(config) => {
            setFilters(config.filters);
            setGroupFilterId(config.groupFilterId);
          }}
        />
      </div>

      {(!startColumnId || !durationColumnId) && (
        <p className="text-sm text-neutral-400 dark:text-neutral-500">
          請先選擇開始日期欄位與天數欄位,才能顯示甘特圖時間軸。
        </p>
      )}

      {startColumnId && durationColumnId && days.length === 0 && (
        <p className="text-sm text-neutral-400 dark:text-neutral-500">
          目前沒有項目同時填寫了開始日期與天數。
        </p>
      )}

      {startColumnId && durationColumnId && days.length > 0 && (
        // In fullscreen this is a flex column filling whatever height the
        // toolbar above leaves over, so any number of filter rows still ends
        // up with the chart exactly filling the rest of the viewport.
        <div className={isFullscreen ? "flex min-h-0 flex-1 flex-col" : ""}>
          <div
            ref={topScrollRef}
            onScroll={syncFromTopScroll}
            className="sticky top-0 z-30 mb-1 shrink-0 overflow-x-auto overflow-y-hidden bg-white dark:bg-neutral-900"
            style={{ height: 14 }}
          >
            <div style={{ width: contentWidth * (scalePct / 100), height: 1 }} />
          </div>
          <div
            ref={scrollRef}
            onScroll={syncFromMainScroll}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerLeave={handlePointerUp}
            className={`${isFullscreen ? "min-h-0 flex-1" : "max-h-[65vh]"} overflow-auto rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 ${
              isPanning ? "cursor-grabbing select-none" : "cursor-grab"
            }`}
          >
          <div style={{ zoom: scalePct / 100 }}>
          <div ref={contentRef} className="relative" style={{ minWidth: labelWidth + days.length * dayWidth }}>
            {showArrows && dependencyArrows.length > 0 && (
              <svg
                className="pointer-events-none absolute inset-0 z-[6] h-full w-full overflow-visible"
                aria-hidden
              >
                {dependencyArrows.map((arrow) => (
                  <g
                    key={arrow.key}
                    className={
                      arrow.critical
                        ? "stroke-red-500 fill-red-500"
                        : "stroke-neutral-400 fill-neutral-400 dark:stroke-neutral-500 dark:fill-neutral-500"
                    }
                  >
                    <title>{arrow.title}</title>
                    <path d={arrow.path} fill="none" strokeWidth={1.25} />
                    <path d={arrow.head} strokeWidth={0} />
                  </g>
                ))}
              </svg>
            )}
            {todayIndex >= 0 && (
              <div
                className="pointer-events-none absolute top-0 bottom-0 z-[5] w-px bg-red-400"
                style={{ left: labelWidth + todayIndex * dayWidth }}
                title="今天"
              />
            )}
            <div className="sticky top-0 z-20 flex">
              <div
                className="sticky left-0 z-10 shrink-0 relative border-b border-r border-neutral-100 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800 px-2 py-1.5 text-xs font-medium text-neutral-500 dark:text-neutral-400"
                style={{ width: labelWidth }}
              >
                項目
                <div
                  onPointerDown={startLabelResize}
                  className="absolute right-0 top-0 z-20 h-full w-1 cursor-col-resize hover:bg-blue-400"
                  style={{ touchAction: "none" }}
                />
              </div>
              <div className="flex border-b border-neutral-100 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800">
                {headerSegments.map((seg) => {
                  const segDate = zoom === "day" ? new Date(seg.key) : null;
                  const holidayName = segDate ? holidayNameByDate.get(toIsoDate(segDate)) : undefined;
                  return (
                    <div
                      key={seg.key}
                      title={holidayName}
                      className="shrink-0 truncate border-r border-neutral-100 dark:border-neutral-700 py-1.5 text-center text-xs text-neutral-500 dark:text-neutral-400"
                      style={{ width: seg.days * dayWidth, backgroundColor: segDate ? dayShade(segDate) : undefined }}
                    >
                      {seg.sublabel && <div className="text-[10px] text-neutral-400 dark:text-neutral-500">{seg.sublabel}</div>}
                      {seg.label}
                    </div>
                  );
                })}
              </div>
            </div>

            {groupSections.flatMap(({ group, roots, visibleCount }) => [
              <div
                key={`group:${group.id}`}
                className="flex items-stretch border-b border-neutral-200 dark:border-neutral-700"
              >
                <div
                  className="sticky left-0 z-10 flex shrink-0 items-center gap-2 bg-neutral-50 dark:bg-neutral-800 px-2 py-1.5 text-sm font-semibold text-neutral-700 dark:text-neutral-100"
                  style={{ width: labelWidth, borderLeft: `4px solid ${group.color}` }}
                >
                  <span className="min-w-0 flex-1 truncate">{group.name}</span>
                  <span className="shrink-0 text-xs font-normal text-neutral-400 dark:text-neutral-500">
                    {visibleCount} 項目
                  </span>
                </div>
                <div
                  className="shrink-0 bg-neutral-50 dark:bg-neutral-800"
                  style={{ width: days.length * dayWidth, height: 34 }}
                />
              </div>,
              ...renderRows(renderRootParentId, 0, roots),
            ])}

          {usersWithLoad.length > 0 && (
            <div>
              <div className="flex border-t-2 border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800 px-2 py-1.5 text-xs font-medium text-neutral-500 dark:text-neutral-400">
                人員負載
              </div>
              {usersWithLoad.map((u) => (
                <div key={u.id} className="flex items-stretch border-b border-neutral-100 dark:border-neutral-700">
                  <div
                    className="sticky left-0 z-10 flex shrink-0 items-center bg-white dark:bg-neutral-900 px-2 py-1.5 text-sm"
                    style={{ width: labelWidth }}
                  >
                    {u.name}
                  </div>
                  <div className="flex shrink-0">
                    {days.map((d) => {
                      const load = dailyLoad.get(u.id)?.get(toIsoDate(d)) ?? 0;
                      const bg =
                        load === 0
                          ? (dayShade(d) ?? "transparent")
                          : load > 100
                            ? "#e2445c"
                            : "#00c875";
                      return (
                        <div
                          key={toIsoDate(d)}
                          title={load > 0 ? `${formatDay(d)}: ${load}%` : undefined}
                          className="shrink-0 border-r border-neutral-100 dark:border-neutral-700"
                          style={{
                            width: dayWidth,
                            height: 24,
                            backgroundColor: bg,
                            opacity: load > 0 ? Math.min(1, 0.35 + load / 200) : 1,
                          }}
                        />
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
          </div>
          </div>
          </div>
        </div>
      )}

      <AssignmentModal
        boardId={board.id}
        item={liveAssignmentItem}
        users={users}
        currentUserId={currentUserId}
        userRole={userRole}
        open={assignmentItem !== null}
        onOpenChange={(open) => !open && setAssignmentItem(null)}
        columns={board.columns}
        predColumnId={predColumnId}
        linkColumnId={linkColumnId}
        lagColumnId={lagColumnId}
        durationColumnId={board.manualDurationColumnId ?? durationColumnId}
        manualStartColumnId={board.manualStartColumnId}
        ganttStartColumnId={startColumnId}
        ganttEndColumnId={endColumnId}
        predLamp={liveAssignmentItem ? predLamps.get(liveAssignmentItem.id) : null}
        canEditSchedule={liveAssignmentItem ? canEditItemSchedule(liveAssignmentItem) : false}
        groupItems={
          liveAssignmentItem
            ? board.items.filter((i) => i.groupId === liveAssignmentItem.groupId)
            : undefined
        }
      />

      <ItemDetailModal
        boardId={board.id}
        item={liveDetailItem}
        columns={board.columns}
        users={users}
        progressColumnId={board.progressColumnId}
        ganttStartColumnId={startColumnId}
        ganttDurationColumnId={durationColumnId}
        ganttEndColumnId={endColumnId}
        predColumnId={predColumnId}
        linkColumnId={linkColumnId}
        predLamp={liveDetailItem ? predLamps.get(liveDetailItem.id) : null}
        scheduleFloat={liveDetailItem ? scheduleFloats.get(liveDetailItem.id) : undefined}
        groupItems={
          liveDetailItem ? board.items.filter((i) => i.groupId === liveDetailItem.groupId) : undefined
        }
        lockedScheduleFields={lockedScheduleFields}
        manualScheduleHint={manualScheduleHint}
        userRole={userRole}
        currentUserId={currentUserId}
        open={detailItem !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDetailItem(null);
            setDetailInitialTab("updates");
          }
        }}
        initialTab={detailInitialTab}
      />
    </div>
  );
}

/** Builds the confirm-dialog text for a Gantt drag: the day range before and
 *  after, and the resulting change in Days — shown before any drag (resize
 *  or whole-bar move) is actually applied. For a whole-bar move, `fixedDays`
 *  is the Days value the move is known to preserve exactly — passing it
 *  skips re-deriving a business-day count from the raw dates, which can
 *  disagree with the stored Days value when the (unmoved) Start itself
 *  falls on a non-working day. */
function describeScheduleChange(
  oldStart: Date,
  oldEnd: Date,
  newStart: Date,
  newEnd: Date,
  mode: GanttDurationMode,
  holidays: Set<string>,
  fixedDays?: number
): string {
  const oldDays = fixedDays ?? countDaysInRange(oldStart, oldEnd, mode, holidays);
  const newDays = fixedDays ?? countDaysInRange(newStart, newEnd, mode, holidays);
  const delta = (newDays ?? 0) - (oldDays ?? 0);
  const deltaLabel = delta === 0 ? "天數不變" : delta > 0 ? `增加 ${delta} 天` : `減少 ${Math.abs(delta)} 天`;
  return [
    `開始日期:${toIsoDate(oldStart)} → ${toIsoDate(newStart)}`,
    `結束日期:${toIsoDate(oldEnd)} → ${toIsoDate(newEnd)}`,
    `天數:${oldDays ?? "-"} → ${newDays ?? "-"}(${deltaLabel})`,
  ].join("\n");
}

/** Enough of the knock-on list to judge the blast radius without turning the
 *  dialog into a wall of text. */
const MAX_CASCADE_LINES = 12;

/** The "and these move with it" section of the drag confirmation. */
function describeCascade(cascaded: CascadedItem[]): string[] {
  if (cascaded.length === 0) return [];
  const shown = cascaded.slice(0, MAX_CASCADE_LINES);
  const lines = shown.map(
    (c) => `・${c.wbsCode} ${c.name}:${c.oldStart}~${c.oldEnd} → ${c.newStart}~${c.newEnd}`
  );
  if (cascaded.length > shown.length) {
    lines.push(`・…另外還有 ${cascaded.length - shown.length} 項`);
  }
  return ["", `依前置依賴連動,以下 ${cascaded.length} 個項目也會一起移動:`, ...lines];
}

function GanttBar({
  boardId,
  item,
  range,
  dayWidth,
  dayIndexByIso,
  days,
  users,
  durationMode,
  holidaySet,
  isMilestone,
  startLocked,
  endLocked,
  daysLocked,
  lockCause,
  scheduleFloat,
  highlightCritical = false,
  canEdit,
  onClick,
}: {
  boardId: string;
  item: ItemData;
  range: DateRange;
  dayWidth: number;
  dayIndexByIso: Map<string, number>;
  days: Date[];
  users: UserOption[];
  durationMode: GanttDurationMode;
  holidaySet: Set<string>;
  isMilestone: boolean;
  startLocked: boolean;
  endLocked: boolean;
  daysLocked: boolean;
  /** What is actually driving these dates — see scheduleLockCause. */
  lockCause?: string | null;
  /** Total float from the CPM backward pass; absent for summaries and for
   *  items with no dates, which are not in the network. */
  scheduleFloat?: ScheduleFloat;
  /** Whether the 要徑 toggle is on — the ring only draws then, so the chart
   *  isn't permanently striped in red. */
  highlightCritical?: boolean;
  canEdit: boolean;
  onClick?: () => void;
}) {
  const startIndex = dayIndexByIso.get(toIsoDate(range.start)) ?? 0;
  const endIndex = dayIndexByIso.get(toIsoDate(range.end)) ?? startIndex;
  // While dragging, offsetPx tracks the pointer continuously (in raw pixels,
  // not day-quantized) so the bar follows the mouse smoothly; the drag is
  // only snapped to a day boundary once, at release — see handleDragUp.
  const [drag, setDrag] = useState<{
    edge: "start" | "end" | "move";
    originStartIndex: number;
    originEndIndex: number;
    originX: number;
    offsetPx: number;
  } | null>(null);

  const { confirm, notify } = useDialogs();

  const canResizeStart = canEdit && !startLocked && !daysLocked;
  const canResizeEnd = canEdit && !endLocked && !daysLocked;
  const canMove = canEdit && !startLocked && !endLocked;

  // Explains why a drag can't proceed — shown as a prompt the moment the
  // user actually attempts it (not just hidden with no feedback), and also
  // as the handle's hover title. Permission is checked first since it's the
  // more fundamental reason when both apply.
  function blockedReason(field: "start" | "end" | "move"): string | null {
    if (!canEdit) return "權限不足:僅建立者、分組的Team Leader/PMD或管理者可以調整此項目的時程";
    const locked = field === "start" ? startLocked || daysLocked : field === "end" ? endLocked || daysLocked : startLocked || endLocked;
    if (!locked) return null;
    if (lockCause) return lockCause;
    return field === "move"
      ? "此時程由前置依賴或子項目統計自動計算,無法整體搬移"
      : "此日期由前置依賴、子項目統計或里程碑規則自動計算,請改天數、前置依賴或子項目設定";
  }

  let left = startIndex * dayWidth;
  let width = (endIndex - startIndex + 1) * dayWidth;
  if (drag) {
    const baseLeft = drag.originStartIndex * dayWidth;
    const baseWidth = (drag.originEndIndex - drag.originStartIndex + 1) * dayWidth;
    const timelineWidth = days.length * dayWidth;
    if (drag.edge === "start") {
      const clamped = Math.max(-baseLeft, Math.min(drag.offsetPx, baseWidth - dayWidth));
      left = baseLeft + clamped;
      width = baseWidth - clamped;
    } else if (drag.edge === "end") {
      const clamped = Math.max(dayWidth - baseWidth, Math.min(drag.offsetPx, timelineWidth - baseLeft - baseWidth));
      width = baseWidth + clamped;
    } else if (canMove) {
      const clamped = Math.max(-baseLeft, Math.min(drag.offsetPx, timelineWidth - baseLeft - baseWidth));
      left = baseLeft + clamped;
    }
    // else (a blocked move): stay put while dragging — the bar doesn't
    // visually slide for a move it can't actually make; the reason shows
    // as a prompt once the user releases (see handleDragUp).
  }
  const totalPct = item.assignments.reduce((sum, a) => sum + a.allocationPct, 0);
  // The bar's current Days value, held fixed while moving — a move must
  // preserve it exactly, even though a fixed calendar-day span can cover a
  // different number of business days once it crosses a weekend/holiday.
  const fixedDurationDays = countDaysInRange(range.start, range.end, durationMode, holidaySet) ?? 1;

  /** Confirms a drag, spelling out both this item's change and every item the
   *  Pred/Link chain would carry along with it. A failed preview must not
   *  block the drag — the list is just left out. */
  async function confirmScheduleChange(summary: string, newStart: Date, newEnd: Date): Promise<boolean> {
    let cascaded: CascadedItem[] = [];
    try {
      cascaded = await previewDragCascade(boardId, item.id, toIsoDate(newStart), toIsoDate(newEnd));
    } catch {
      cascaded = [];
    }
    const message = [summary, ...describeCascade(cascaded), "", "確定要套用這個時程調整嗎?"].join("\n");
    return confirm(message, { title: "調整時程" });
  }

  function handleResizeDown(edge: "start" | "end", e: React.PointerEvent<HTMLDivElement>) {
    e.stopPropagation();
    const reason = blockedReason(edge);
    if (reason) {
      notify(reason);
      return;
    }
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag({ edge, originStartIndex: startIndex, originEndIndex: endIndex, originX: e.clientX, offsetPx: 0 });
  }

  function handleBodyPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    // The bar body is a div (not a real <button>) since a real button's
    // native click would fire alongside our own drag-vs-click detection —
    // but that means the outer chart's whole-timeline pan handler no longer
    // recognizes it via closest("button") and would otherwise also start
    // panning on the same pointerdown, stealing pointer capture from this
    // bar and making the drag fight itself. Always capture (even when the
    // move itself is blocked) so a real drag attempt is distinguishable
    // from a plain click at pointerup — see handleDragUp.
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag({ edge: "move", originStartIndex: startIndex, originEndIndex: endIndex, originX: e.clientX, offsetPx: 0 });
  }

  function handleDragMove(e: React.PointerEvent<HTMLDivElement>) {
    setDrag((prev) => (prev ? { ...prev, offsetPx: e.clientX - prev.originX } : prev));
  }

  async function handleDragUp(e: React.PointerEvent<HTMLDivElement>) {
    e.stopPropagation();
    const current = drag;
    setDrag(null);
    if (!current) return;
    const deltaIndex = Math.round(current.offsetPx / dayWidth);

    if (current.edge === "move") {
      const draggedFar = Math.abs(current.offsetPx) > 3;
      if (!draggedFar) {
        onClick?.();
        return;
      }
      const moveReason = blockedReason("move");
      if (moveReason) {
        await notify(moveReason);
        return;
      }
      if (deltaIndex === 0) return;
      const span = current.originEndIndex - current.originStartIndex;
      const newStartIndex = Math.max(0, Math.min(current.originStartIndex + deltaIndex, days.length - 1 - span));
      const newStartDate = days[newStartIndex];
      if (!newStartDate || newStartIndex === current.originStartIndex) return;
      const newEndDate = endFromStartAndDays(newStartDate, fixedDurationDays, durationMode, holidaySet);
      const message = describeScheduleChange(
        range.start,
        range.end,
        newStartDate,
        newEndDate,
        durationMode,
        holidaySet,
        fixedDurationDays
      );
      if (!(await confirmScheduleChange(message, newStartDate, newEndDate))) return;
      try {
        await moveItemBar(boardId, item.id, toIsoDate(newStartDate));
      } catch (err) {
        await notify(err instanceof Error ? err.message : "調整失敗", { title: "無法調整時程" });
      }
      return;
    }

    const maxIndex = days.length - 1;
    const newIndex =
      current.edge === "start"
        ? Math.max(0, Math.min(current.originStartIndex + deltaIndex, current.originEndIndex))
        : Math.min(maxIndex, Math.max(current.originEndIndex + deltaIndex, current.originStartIndex));
    const originalIndex = current.edge === "start" ? startIndex : endIndex;
    if (newIndex === originalIndex) return;
    const newDate = days[newIndex];
    if (!newDate) return;
    const newStart = current.edge === "start" ? newDate : range.start;
    const newEnd = current.edge === "end" ? newDate : range.end;
    const message = describeScheduleChange(range.start, range.end, newStart, newEnd, durationMode, holidaySet);
    if (!(await confirmScheduleChange(message, newStart, newEnd))) return;

    try {
      await resizeItemBar(boardId, item.id, current.edge, toIsoDate(newDate));
    } catch (err) {
      await notify(err instanceof Error ? err.message : "調整失敗", { title: "無法調整時程" });
    }
  }

  // Only while 要徑 is switched on: the ring and the bolt are the two halves
  // of the same answer, so they appear and disappear together.
  const isCritical = highlightCritical && !!scheduleFloat?.isCritical;

  return (
    <div
      data-gantt-bar=""
      className="absolute top-1/2 -translate-y-1/2"
      style={{ left, width, height: 20 }}
    >
      <div
        onPointerDown={(e) => handleResizeDown("start", e)}
        onPointerMove={handleDragMove}
        onPointerUp={handleDragUp}
        className={`absolute left-0 top-0 z-10 h-full w-1.5 rounded-l ${
          canResizeStart ? "cursor-col-resize hover:bg-blue-500/60" : "cursor-not-allowed"
        }`}
        style={{ touchAction: "none" }}
        title={canResizeStart ? "拖曳調整開始日期" : (blockedReason("start") ?? undefined)}
      />
      <div
        role={onClick ? "button" : undefined}
        tabIndex={onClick ? 0 : undefined}
        onPointerDown={handleBodyPointerDown}
        onPointerMove={handleDragMove}
        onPointerUp={handleDragUp}
        onKeyDown={(e) => {
          if (onClick && (e.key === "Enter" || e.key === " ")) onClick();
        }}
        className={`absolute inset-0 flex rounded ${isMilestone ? "overflow-visible" : "overflow-hidden"} ${
          isCritical ? "ring-[3px] ring-red-500" : ""
        }`}
        style={{
          cursor: drag?.edge === "move" ? "grabbing" : canMove ? "grab" : onClick ? "pointer" : "not-allowed",
          touchAction: "none",
        }}
        title={[
          isMilestone
            ? `里程碑:${toIsoDate(range.start)}`
            : item.assignments.map((a) => `${a.user.name} ${a.allocationPct}%`).join(", "),
          scheduleFloat ? describeFloat(scheduleFloat) : "",
        ]
          .filter(Boolean)
          .join("\n")}
      >
        {/* A milestone is already its own shape — a bolt on top of the star
            would just be two symbols fighting for the same 20 pixels. */}
        {isCritical && !isMilestone && (
          <span className="pointer-events-none absolute left-0.5 top-1/2 z-10 flex h-3.5 w-3.5 -translate-y-1/2 items-center justify-center rounded-full bg-black">
            <Zap size={9} className="fill-amber-400 text-amber-400" />
          </span>
        )}
        {isMilestone ? (
          <div className="flex h-full w-full items-center justify-center">
            <Star size={16} className="fill-amber-400 text-amber-500" />
          </div>
        ) : item.assignments.length === 0 ? (
          <div className="h-full w-full bg-neutral-300" />
        ) : (
          item.assignments.map((a) => (
            <div
              key={a.userId}
              className="flex h-full items-center justify-center overflow-hidden text-[10px] font-medium text-white"
              style={{
                width: `${(a.allocationPct / totalPct) * 100}%`,
                backgroundColor: colorForUser(a.userId, users),
              }}
            >
              {a.user.name.slice(0, 2)}
            </div>
          ))
        )}
      </div>
      <div
        onPointerDown={(e) => handleResizeDown("end", e)}
        onPointerMove={handleDragMove}
        onPointerUp={handleDragUp}
        className={`absolute right-0 top-0 z-10 h-full w-1.5 rounded-r ${
          canResizeEnd ? "cursor-col-resize hover:bg-blue-500/60" : "cursor-not-allowed"
        }`}
        style={{ touchAction: "none" }}
        title={canResizeEnd ? "拖曳調整結束日期" : (blockedReason("end") ?? undefined)}
      />
    </div>
  );
}

/**
 * The saved plan, drawn as a thin bar under the real one — the standard Gantt
 * way to show drift, and the only way to see at a glance which tasks moved and
 * which held. Hidden entirely when the board has no baseline.
 */
function BaselineBar({
  item,
  dayIndexByIso,
  dayWidth,
}: {
  item: ItemData;
  dayIndexByIso: Map<string, number>;
  dayWidth: number;
}) {
  if (!item.baselineStart || !item.baselineEnd) return null;
  const startIndex = dayIndexByIso.get(item.baselineStart);
  const endIndex = dayIndexByIso.get(item.baselineEnd);
  // Outside the chart's own day range — nothing to place it against.
  if (startIndex === undefined || endIndex === undefined) return null;

  const variance = resolveBaselineVariance(item, {
    start: new Date(item.baselineStart),
    end: new Date(item.baselineEnd),
  });
  return (
    <div
      className="pointer-events-none absolute bottom-0.5 rounded-sm bg-neutral-400/70 dark:bg-neutral-500/70"
      style={{
        left: startIndex * dayWidth,
        width: Math.max((endIndex - startIndex + 1) * dayWidth, 2),
        height: 4,
      }}
      title={`基準線:${item.baselineStart} ~ ${item.baselineEnd}${
        variance ? `(${item.baselineDays ?? "-"} 天)` : ""
      }`}
    />
  );
}

/** The float line on a bar's hover, in the words a schedule is read in. */
function describeFloat(scheduleFloat: ScheduleFloat): string {
  if (scheduleFloat.totalFloat < 0) {
    return `要徑・已落後 ${Math.abs(scheduleFloat.totalFloat)} 天(最晚需完成於 ${toIsoDate(
      scheduleFloat.lateFinish
    )})`;
  }
  if (scheduleFloat.totalFloat === 0) {
    return "要徑・總浮時 0 天,延一天整個專案就延一天";
  }
  return `總浮時 ${scheduleFloat.totalFloat} 天(最晚可完成於 ${toIsoDate(scheduleFloat.lateFinish)})`;
}

/** Whether two measurement passes found every bar in the same place. */
function sameBoxes(a: Map<string, BarBox>, b: Map<string, BarBox>): boolean {
  if (a.size !== b.size) return false;
  for (const [id, box] of a) {
    const other = b.get(id);
    if (!other) return false;
    if (
      Math.abs(other.left - box.left) > 0.5 ||
      Math.abs(other.right - box.right) > 0.5 ||
      Math.abs(other.centerY - box.centerY) > 0.5
    ) {
      return false;
    }
  }
  return true;
}
