import type { GanttDurationMode } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getStatusOptions } from "@/types/column";
import type { ItemData } from "@/types/board";
import { getItemDateRange, hasOwnScheduleRule, type DateRange } from "@/lib/gantt";
import { endFromStartAndDays, shiftDate } from "@/lib/workday";
import { listHolidays, toHolidaySet } from "@/lib/holidays";

export type RelationshipType = "FS" | "FF" | "SS" | "SF";
const RELATIONSHIP_TYPES: RelationshipType[] = ["FS", "FF", "SS", "SF"];

export type WbsIndex = {
  /** itemId -> its WBS code, LOCAL to its own group (e.g. "1.3.4") — unique
   *  per item, but the same code string is reused by every group (each
   *  group's own top-level items start back at "1"), so this alone is not
   *  enough to resolve a Pred reference; use resolveWbsCode for that. */
  wbsByItemId: Map<string, string>;
  /** `${groupId}:${code}` -> itemId. Internal — use resolveWbsCode. */
  itemIdByGroupWbs: Map<string, string>;
  /** itemId -> its group, so a Pred value that is already an item id can be
   *  checked against the referencing item's own group. */
  groupByItemId: Map<string, string>;
};

/**
 * Rebuilds each item's WBS-style code (e.g. "1.3.4") from its parent/order
 * structure, one independent tree PER GROUP — matching exactly what
 * computeWbsCodes shows the user in the table (each group's own top-level
 * items restart at "1"). A Pred reference like "1.2.2.4" is only meaningful
 * within the referencing item's own group, so codes are intentionally NOT
 * unique board-wide — always resolve them via resolveWbsCode, passing the
 * referencing item's groupId, never by reading itemIdByGroupWbs directly.
 * Pure — no DB access, so it can run identically client-side (against
 * already-loaded board.items) or server-side.
 */
export function buildWbsIndexFromItems(
  items: { id: string; parentId: string | null; order: number; groupId: string }[]
): WbsIndex {
  const wbsByItemId = new Map<string, string>();
  const itemIdByGroupWbs = new Map<string, string>();
  const groupByItemId = new Map<string, string>();

  const itemsByGroup = new Map<string, typeof items>();
  for (const item of items) {
    const list = itemsByGroup.get(item.groupId) ?? [];
    list.push(item);
    itemsByGroup.set(item.groupId, list);
  }

  for (const [groupId, groupItems] of itemsByGroup) {
    const childrenByParent = new Map<string | null, typeof items>();
    for (const item of groupItems) {
      const list = childrenByParent.get(item.parentId) ?? [];
      list.push(item);
      childrenByParent.set(item.parentId, list);
    }
    for (const list of childrenByParent.values()) list.sort((a, b) => a.order - b.order);

    function assign(parentId: string | null, prefix: string) {
      const kids = childrenByParent.get(parentId) ?? [];
      kids.forEach((kid, idx) => {
        const code = prefix ? `${prefix}.${idx + 1}` : String(idx + 1);
        wbsByItemId.set(kid.id, code);
        itemIdByGroupWbs.set(`${groupId}:${code}`, kid.id);
        groupByItemId.set(kid.id, groupId);
        assign(kid.id, code);
      });
    }
    assign(null, "");
  }

  return { wbsByItemId, itemIdByGroupWbs, groupByItemId };
}

/** Resolves a Pred cell's raw WBS-code string to an item id, scoped to
 *  `groupId` (always the referencing item's own group — a Pred reference
 *  can't cross groups, matching the codes as actually displayed per-group). */
export function resolveWbsCode(index: WbsIndex, groupId: string, code: string): string | undefined {
  return index.itemIdByGroupWbs.get(`${groupId}:${code}`);
}

/**
 * Resolves a Pred cell's stored value to the item it points at.
 *
 * The value is the target item's id. Ids are stable: inserting, deleting or
 * re-ordering items renumbers every WBS code below the change, so a code is a
 * reference to a POSITION, not to a task — insert one row and every Pred
 * under it silently starts pointing at its neighbour.
 *
 * A WBS code is still accepted as a fallback, because that is what a
 * spreadsheet import brings in and what was stored before the switch. Such a
 * reference carries the positional hazard above until it is re-picked or
 * backfilled, so it is only ever the second guess.
 */
export function resolvePredValue(index: WbsIndex, groupId: string, value: string): string | undefined {
  if (index.groupByItemId.get(value) === groupId) return value;
  return index.itemIdByGroupWbs.get(`${groupId}:${value}`);
}

export async function buildWbsIndex(boardId: string) {
  const items = await prisma.item.findMany({
    where: { boardId },
    select: { id: true, parentId: true, order: true, groupId: true },
  });
  return buildWbsIndexFromItems(items);
}

/**
 * This item's Start/Finish, given a predecessor's own [start, end], the
 * relationship type, a lag offset (days, same calendar/business semantics
 * as the board's duration mode — negative lag means lead/overlap), and this
 * item's own duration. FS/SS anchor on Start and derive Finish forward;
 * FF/SF anchor on Finish and derive Start backward.
 */
export function computeScheduledRange(
  predRange: DateRange,
  myDays: number,
  relationship: RelationshipType,
  lag: number,
  mode: GanttDurationMode,
  holidays: Set<string>
): DateRange | null {
  if (!Number.isFinite(myDays) || myDays < 0) return null;
  const span = Math.max(Math.round(myDays) - 1, 0);

  if (relationship === "FS" || relationship === "SS") {
    const start =
      relationship === "FS"
        ? shiftDate(predRange.end, 1 + lag, mode, holidays)
        : shiftDate(predRange.start, lag, mode, holidays);
    return { start, end: shiftDate(start, span, mode, holidays) };
  }

  const end =
    relationship === "FF"
      ? shiftDate(predRange.end, lag, mode, holidays)
      : shiftDate(predRange.start, lag, mode, holidays);
  return { start: shiftDate(end, -span, mode, holidays), end };
}

export type ScheduleLock = { startLocked: boolean; endLocked: boolean; daysLocked: boolean };

/**
 * The range start(set) + the resolved length describe, for an "always
 * computed" board. Not getItemDateRange against the two manual columns:
 * that needs a number in the duration cell, so an item with a start(set)
 * but a blank duration would have no base range at all and could never be
 * moved — even though resolveScheduleDays knows how long it is.
 */
function manualBaseRange(
  cellValues: { columnId: string; value: unknown }[],
  manualStartColumnId: string,
  days: number | null,
  mode: GanttDurationMode,
  holidays: Set<string>
): DateRange | null {
  const startValue = cellValues.find((cv) => cv.columnId === manualStartColumnId)?.value;
  if (typeof startValue !== "string" || days === null || days < 0) return null;
  const start = new Date(startValue);
  if (Number.isNaN(start.getTime())) return null;
  return { start, end: endFromStartAndDays(start, days, mode, holidays) };
}

/**
 * How many days long an item is, in an "always computed" board: its manual
 * duration column, falling back to the Days column when that's blank.
 *
 * Days is what scheduling *writes*, so reading it back as the length is a
 * fixpoint, not a circular input — and it's what keeps an item imported with
 * a length but no manual duration (URSROBOT專案 has a handful) schedulable
 * from its predecessor at the length it already has, instead of frozen at
 * whatever dates it was imported with. Null only when neither is set, which
 * genuinely leaves nothing to compute a Finish from.
 */
export function resolveScheduleDays(
  cellValues: { columnId: string; value: unknown }[],
  manualDurationColumnId: string | null | undefined,
  daysColumnId: string
): number | null {
  const manual = cellValues.find((cv) => cv.columnId === manualDurationColumnId)?.value;
  if (typeof manual === "number") return manual;
  const days = cellValues.find((cv) => cv.columnId === daysColumnId)?.value;
  return typeof days === "number" ? days : null;
}

/**
 * For every item, which of its Start/Finish/Days is computed elsewhere and
 * therefore not manually editable:
 *  - when the board has both a manual-start and manual-duration column
 *    configured, Start/Finish/Days are unconditionally locked for every
 *    item — they're always computed from those + Pred/Link/Lag (see
 *    syncPredecessorSchedule), never a free manual input
 *  - otherwise (the pre-existing behavior): an item with children has its
 *    Start+Finish rolled up from its subtree (a "Summary" row) regardless of
 *    its own Type value; an item whose Pred resolves to a real predecessor
 *    and whose Link resolves to a valid relationship type has the date that
 *    relationship determines locked (FS/SS -> Start, FF/SF -> Finish); an
 *    item whose Type resolves to "Milestone" has Days locked at 0
 * Pure — safe to call client-side against already-loaded items, or
 * server-side. All params past `items` are optional since not every board
 * configures them.
 */
export function resolveLockedScheduleFields(
  items: Pick<ItemData, "id" | "parentId" | "order" | "cellValues" | "groupId">[],
  predColumnId?: string | null,
  linkColumnId?: string | null,
  linkColumnOptions?: unknown,
  typeColumnId?: string | null,
  typeColumnOptions?: unknown,
  manualStartColumnId?: string | null,
  manualDurationColumnId?: string | null,
  /** The manual-start column, for testing whether an item has a schedule rule
   *  of its own, when the caller is deliberately NOT applying the blanket
   *  always-computed lock above — the drag paths, which need to know what
   *  really decides the dates rather than which cells are typeable. */
  ownRuleStartColumnId?: string | null
): Map<string, ScheduleLock> {
  const result = new Map<string, ScheduleLock>();

  if (manualStartColumnId && manualDurationColumnId) {
    for (const item of items) {
      result.set(item.id, { startLocked: true, endLocked: true, daysLocked: true });
    }
    return result;
  }

  const wbsIndex = buildWbsIndexFromItems(items);
  const linkOptions = linkColumnId ? getStatusOptions(linkColumnOptions) : [];
  const typeOptions = typeColumnId ? getStatusOptions(typeColumnOptions) : [];

  const childCount = new Map<string, number>();
  for (const item of items) {
    if (item.parentId) childCount.set(item.parentId, (childCount.get(item.parentId) ?? 0) + 1);
  }
  const ownRuleColumns = {
    predColumnId,
    manualStartColumnId: ownRuleStartColumnId ?? manualStartColumnId,
  };

  function ensure(id: string): ScheduleLock {
    let lock = result.get(id);
    if (!lock) {
      lock = { startLocked: false, endLocked: false, daysLocked: false };
      result.set(id, lock);
    }
    return lock;
  }

  for (const item of items) {
    // A summary with a schedule rule of its own keeps its own dates instead of
    // taking them from its subtree — the same exception computeRolledUpDateRange
    // makes. Without this its bar shows its own dates but refuses to be
    // dragged, with nothing to point at as the cause.
    if ((childCount.get(item.id) ?? 0) > 0 && !hasOwnScheduleRule(item, ownRuleColumns)) {
      const lock = ensure(item.id);
      lock.startLocked = true;
      lock.endLocked = true;
    }

    if (predColumnId && linkColumnId) {
      const predValue = item.cellValues.find((cv) => cv.columnId === predColumnId)?.value;
      if (typeof predValue === "string" && predValue) {
        const predItemId = resolvePredValue(wbsIndex, item.groupId, predValue);
        if (predItemId && predItemId !== item.id) {
          const linkValue = item.cellValues.find((cv) => cv.columnId === linkColumnId)?.value;
          const label = linkOptions.find((o) => o.id === linkValue)?.label;
          if (label === "FS" || label === "SS") ensure(item.id).startLocked = true;
          else if (label === "FF" || label === "SF") ensure(item.id).endLocked = true;
        }
      }
    }

    if (typeColumnId) {
      const typeValue = item.cellValues.find((cv) => cv.columnId === typeColumnId)?.value;
      const typeLabel = typeOptions.find((o) => o.id === typeValue)?.label;
      if (typeLabel === "Milestone") ensure(item.id).daysLocked = true;
    }
  }

  return result;
}

/**
 * Loads everything needed to schedule a board's Pred/Link-driven items and
 * returns a `recompute(id, visited)` walker: computes that item's own
 * Start/Finish (and, in "always computed" boards, Days too) from its
 * predecessor if it has a valid one, else — only for "always computed"
 * boards — from its own manual-start/manual-duration columns; writes the
 * result, then cascades to every item whose Pred points back at it —
 * transitively, with the shared `visited` set guarding against circular
 * references. Shared by `syncPredecessorSchedule` (recompute from one edited
 * item) and `recomputeAllSchedules` (recompute the whole board). Returns
 * null if the board hasn't configured enough columns to compute anything:
 * Start+Days are always required as the write target, plus either
 * Pred+Link (classic mode) or manualStart+manualDuration ("always computed"
 * mode, which also works without Pred/Link configured — then only the
 * manual columns feed Start/Finish/Days, with no predecessor override).
 */
async function buildScheduleContext(
  boardId: string,
  groupId?: string,
  /** Walk the cascade without touching the database — used to show the user
   *  which downstream items a drag would move, before it moves them. */
  dryRun = false
) {
  const board = await prisma.board.findUnique({
    where: { id: boardId },
    select: {
      predColumnId: true,
      linkColumnId: true,
      lagColumnId: true,
      ganttStartColumnId: true,
      ganttDurationColumnId: true,
      ganttEndColumnId: true,
      ganttDurationMode: true,
      manualStartColumnId: true,
      manualDurationColumnId: true,
    },
  });
  if (!board) return null;
  const {
    predColumnId,
    linkColumnId,
    lagColumnId,
    ganttEndColumnId: endId,
    ganttDurationMode: mode,
    manualStartColumnId,
    manualDurationColumnId,
  } = board;
  const alwaysComputed = !!manualStartColumnId && !!manualDurationColumnId;
  if (!board.ganttStartColumnId || !board.ganttDurationColumnId) return null;
  if (!alwaysComputed && (!predColumnId || !linkColumnId)) return null;
  const startId: string = board.ganttStartColumnId;
  const durId: string = board.ganttDurationColumnId;

  const [linkColumn, items, holidayRows] = await Promise.all([
    linkColumnId
      ? prisma.column.findUnique({ where: { id: linkColumnId }, select: { options: true } })
      : Promise.resolve(null),
    // A recompute cascade follows Pred/Link and parent/child links, both of
    // which stay inside one group — so a single-item edit only needs that
    // item's group, while a whole-board recompute passes no groupId.
    prisma.item.findMany({
      where: groupId ? { groupId } : { boardId },
      select: { id: true, name: true, parentId: true, order: true, cellValues: true, groupId: true },
    }),
    listHolidays(),
  ]);
  const linkOptions = getStatusOptions(linkColumn?.options);
  const holidays = toHolidaySet(holidayRows);
  const wbsIndex = buildWbsIndexFromItems(items);
  const { wbsByItemId } = wbsIndex;
  const itemsById = new Map(items.map((i) => [i.id, i]));

  // Freshly-computed dates, so a dependent further down the chain reads its
  // predecessor's just-written dates without a mid-walk DB round trip.
  const overrides = new Map<string, DateRange>();

  function readRange(id: string): DateRange | null {
    if (overrides.has(id)) return overrides.get(id)!;
    const item = itemsById.get(id);
    if (!item) return null;
    return getItemDateRange(item, startId, durId, mode, holidays);
  }

  async function writeRange(id: string, range: DateRange, days: number | null) {
    overrides.set(id, range);
    if (dryRun) return;
    const startIso = range.start.toISOString().slice(0, 10);
    await prisma.cellValue.upsert({
      where: { itemId_columnId: { itemId: id, columnId: startId } },
      create: { itemId: id, columnId: startId, value: startIso },
      update: { value: startIso },
    });
    if (endId) {
      const endIso = range.end.toISOString().slice(0, 10);
      await prisma.cellValue.upsert({
        where: { itemId_columnId: { itemId: id, columnId: endId } },
        create: { itemId: id, columnId: endId, value: endIso },
        update: { value: endIso },
      });
    }
    // Days is only ever a write target in "always computed" boards — in the
    // classic mode it's still the free manual input recompute reads from.
    if (alwaysComputed && days !== null) {
      await prisma.cellValue.upsert({
        where: { itemId_columnId: { itemId: id, columnId: durId } },
        create: { itemId: id, columnId: durId, value: days },
        update: { value: days },
      });
    }
  }

  function predecessorOf(id: string): string | undefined {
    if (!predColumnId) return undefined;
    const item = itemsById.get(id);
    const predValue = item?.cellValues.find((cv) => cv.columnId === predColumnId)?.value;
    return item && typeof predValue === "string" ? resolvePredValue(wbsIndex, item.groupId, predValue) : undefined;
  }

  function dependentsOf(id: string): string[] {
    if (!predColumnId) return [];
    const item = itemsById.get(id);
    if (!item) return [];
    // Resolved rather than string-compared: a Pred cell holds an item id now,
    // but may still hold a legacy WBS code — both have to find their target.
    return items
      .filter((i) => {
        if (i.id === id || i.groupId !== item.groupId) return false;
        const value = i.cellValues.find((cv) => cv.columnId === predColumnId)?.value;
        return typeof value === "string" && resolvePredValue(wbsIndex, i.groupId, value) === id;
      })
      .map((i) => i.id);
  }

  /** This item's own days-count and (in "always computed" mode only) its
   *  manual-column base range to fall back to when no predecessor applies. */
  function myDaysAndBase(item: (typeof items)[number]): { myDays: number | null; baseRange: DateRange | null } {
    if (alwaysComputed) {
      const myDays = resolveScheduleDays(item.cellValues, manualDurationColumnId, durId);
      const baseRange = manualBaseRange(item.cellValues, manualStartColumnId!, myDays, mode, holidays);
      return { myDays, baseRange };
    }
    const daysValue = item.cellValues.find((cv) => cv.columnId === durId)?.value;
    return { myDays: typeof daysValue === "number" ? daysValue : null, baseRange: null };
  }

  async function recompute(id: string, visited: Set<string>) {
    if (visited.has(id)) return;
    visited.add(id);

    const item = itemsById.get(id);
    if (item) {
      const predItemId = predecessorOf(id);
      const linkValue = linkColumnId ? item.cellValues.find((cv) => cv.columnId === linkColumnId)?.value : null;
      const relationship = linkOptions.find((o) => o.id === linkValue)?.label;
      const lagValue = lagColumnId ? item.cellValues.find((cv) => cv.columnId === lagColumnId)?.value : null;
      const lag = typeof lagValue === "number" ? lagValue : 0;
      const { myDays, baseRange } = myDaysAndBase(item);

      let scheduled: DateRange | null = null;
      if (
        predItemId &&
        predItemId !== id &&
        relationship &&
        (RELATIONSHIP_TYPES as string[]).includes(relationship) &&
        myDays !== null
      ) {
        const predRange = readRange(predItemId);
        if (predRange) {
          scheduled = computeScheduledRange(predRange, myDays, relationship as RelationshipType, lag, mode, holidays);
        }
      }
      if (!scheduled && alwaysComputed && baseRange) {
        scheduled = baseRange;
      }
      if (scheduled) await writeRange(id, scheduled, myDays);
    }

    for (const depId of dependentsOf(id)) {
      await recompute(depId, visited);
    }
  }

  const ownTriggers = (
    alwaysComputed
      ? [predColumnId, linkColumnId, lagColumnId, manualDurationColumnId, manualStartColumnId]
      : [predColumnId, linkColumnId, lagColumnId, durId]
  ).filter((id): id is string => !!id);
  const cascadeTriggers = [startId, endId].filter((id): id is string => !!id);

  return {
    items,
    itemsById,
    wbsByItemId,
    overrides,
    readRange,
    predecessorOf,
    dependentsOf,
    recompute,
    ownTriggers,
    cascadeTriggers,
  };
}

/** One item a drag would shift, for the confirmation prompt. */
export type CascadedItem = {
  itemId: string;
  name: string;
  wbsCode: string;
  oldStart: string;
  oldEnd: string;
  newStart: string;
  newEnd: string;
};

const isoDay = (date: Date) => date.toISOString().slice(0, 10);

/**
 * Which OTHER items would move if this one were rescheduled to `range`, and
 * where they would land — the Pred/Link chain below it, transitively, the
 * same walk syncPredecessorSchedule performs for real. Read-only: nothing is
 * written, so this can run while the user is still deciding.
 */
export async function previewScheduleCascade(
  boardId: string,
  itemId: string,
  range: DateRange
): Promise<CascadedItem[]> {
  const self = await prisma.item.findUnique({ where: { id: itemId }, select: { groupId: true } });
  if (!self) return [];
  const ctx = await buildScheduleContext(boardId, self.groupId, true);
  if (!ctx) return [];

  const before = new Map<string, DateRange>();
  for (const item of ctx.items) {
    const current = ctx.readRange(item.id);
    if (current) before.set(item.id, current);
  }
  // Seed the dragged item's new dates, then let the walk carry them down the
  // chain exactly as the real recompute would.
  ctx.overrides.set(itemId, range);
  const visited = new Set([itemId]);
  for (const depId of ctx.dependentsOf(itemId)) await ctx.recompute(depId, visited);

  const moved: CascadedItem[] = [];
  for (const [id, next] of ctx.overrides) {
    if (id === itemId) continue;
    const previous = before.get(id);
    if (previous && isoDay(previous.start) === isoDay(next.start) && isoDay(previous.end) === isoDay(next.end)) {
      continue;
    }
    moved.push({
      itemId: id,
      name: ctx.itemsById.get(id)?.name ?? "",
      wbsCode: ctx.wbsByItemId.get(id) ?? "",
      oldStart: previous ? isoDay(previous.start) : "-",
      oldEnd: previous ? isoDay(previous.end) : "-",
      newStart: isoDay(next.start),
      newEnd: isoDay(next.end),
    });
  }
  return moved.sort((a, b) => a.wbsCode.localeCompare(b.wbsCode, undefined, { numeric: true }));
}

/**
 * Keeps a board's Pred/Link-driven items scheduled: editing Pred, Link, Lag,
 * or Days on an item recomputes its own Start/Finish from its predecessor;
 * editing Start/Finish (manually, or as a result of this same recompute)
 * cascades to every item whose Pred points back at it.
 */
/**
 * Which columns can move a schedule, read from the board row alone. Editing
 * anything else (a status, an owner, a comment) can't affect any date, and
 * this check costs one small query — buildScheduleContext, by contrast, has
 * to load every item on the board with its cell values, which is far too
 * much work to do just to discover there was nothing to recompute.
 */
async function scheduleTriggerColumnIds(boardId: string): Promise<Set<string>> {
  const board = await prisma.board.findUnique({
    where: { id: boardId },
    select: {
      predColumnId: true,
      linkColumnId: true,
      lagColumnId: true,
      ganttStartColumnId: true,
      ganttDurationColumnId: true,
      ganttEndColumnId: true,
      manualStartColumnId: true,
      manualDurationColumnId: true,
    },
  });
  if (!board) return new Set();
  const alwaysComputed = !!board.manualStartColumnId && !!board.manualDurationColumnId;
  const own = alwaysComputed
    ? [board.predColumnId, board.linkColumnId, board.lagColumnId, board.manualDurationColumnId, board.manualStartColumnId]
    : [board.predColumnId, board.linkColumnId, board.lagColumnId, board.ganttDurationColumnId];
  return new Set(
    [...own, board.ganttStartColumnId, board.ganttEndColumnId].filter((id): id is string => !!id)
  );
}

export async function syncPredecessorSchedule(
  boardId: string,
  itemId: string,
  editedColumnId: string
) {
  const triggers = await scheduleTriggerColumnIds(boardId);
  if (!triggers.has(editedColumnId)) return;

  const edited = await prisma.item.findUnique({ where: { id: itemId }, select: { groupId: true } });
  const ctx = await buildScheduleContext(boardId, edited?.groupId);
  if (!ctx) return;
  if (!ctx.ownTriggers.includes(editedColumnId) && !ctx.cascadeTriggers.includes(editedColumnId)) return;

  if (ctx.ownTriggers.includes(editedColumnId)) {
    await ctx.recompute(itemId, new Set());
  } else {
    const visited = new Set([itemId]);
    for (const depId of ctx.dependentsOf(itemId)) await ctx.recompute(depId, visited);
  }
}

export type SchedulePreview = { start: string; end: string; days: number | null };

/**
 * What Start/Finish/Days WOULD become for one item if columnId were set to
 * newValue, without writing anything — used by the assignment modal's
 * schedule fields to show "this will move the dates" before the user
 * confirms. Editing one item can only ever change that item's own
 * Start/Finish/Days (a cascade to its dependents happens only after the
 * edit is actually applied), so reading its predecessor's already-persisted
 * range here is exact, not an approximation. Returns null if nothing about
 * the item's own schedule can be determined.
 */
export async function previewScheduleChange(
  boardId: string,
  itemId: string,
  columnId: string,
  newValue: string | number | null
): Promise<SchedulePreview | null> {
  const board = await prisma.board.findUnique({
    where: { id: boardId },
    select: {
      predColumnId: true,
      linkColumnId: true,
      lagColumnId: true,
      ganttStartColumnId: true,
      ganttDurationColumnId: true,
      ganttDurationMode: true,
      manualStartColumnId: true,
      manualDurationColumnId: true,
    },
  });
  if (!board) return null;
  const {
    predColumnId,
    linkColumnId,
    lagColumnId,
    ganttStartColumnId: startId,
    ganttDurationColumnId: durId,
    ganttDurationMode: mode,
    manualStartColumnId,
    manualDurationColumnId,
  } = board;
  const alwaysComputed = !!manualStartColumnId && !!manualDurationColumnId;
  if (!startId || !durId) return null;

  const self = await prisma.item.findUnique({ where: { id: itemId }, select: { groupId: true } });
  if (!self) return null;
  const [linkColumn, items, holidayRows] = await Promise.all([
    linkColumnId
      ? prisma.column.findUnique({ where: { id: linkColumnId }, select: { options: true } })
      : Promise.resolve(null),
    // Group-scoped: a Pred reference resolves within the item's own group.
    prisma.item.findMany({
      where: { groupId: self.groupId },
      select: { id: true, parentId: true, order: true, cellValues: true, groupId: true },
    }),
    listHolidays(),
  ]);
  const item = items.find((i) => i.id === itemId);
  if (!item) return null;
  const linkOptions = getStatusOptions(linkColumn?.options);
  const holidays = toHolidaySet(holidayRows);
  const wbsIndex = buildWbsIndexFromItems(items);
  const itemsById = new Map(items.map((i) => [i.id, i]));

  const cellValues = item.cellValues.map((cv) => (cv.columnId === columnId ? { ...cv, value: newValue } : cv));

  const predValue = predColumnId ? cellValues.find((cv) => cv.columnId === predColumnId)?.value : null;
  const predItemId =
    predColumnId && typeof predValue === "string" ? resolvePredValue(wbsIndex, item.groupId, predValue) : undefined;
  const linkValue = linkColumnId ? cellValues.find((cv) => cv.columnId === linkColumnId)?.value : null;
  const relationship = linkOptions.find((o) => o.id === linkValue)?.label;
  const lagValue = lagColumnId ? cellValues.find((cv) => cv.columnId === lagColumnId)?.value : null;
  const lag = typeof lagValue === "number" ? lagValue : 0;

  let myDays: number | null;
  let baseRange: DateRange | null = null;
  if (alwaysComputed) {
    myDays = resolveScheduleDays(cellValues, manualDurationColumnId, durId);
    baseRange = manualBaseRange(cellValues, manualStartColumnId!, myDays, mode, holidays);
  } else {
    const daysValue = cellValues.find((cv) => cv.columnId === durId)?.value;
    myDays = typeof daysValue === "number" ? daysValue : null;
  }

  let scheduled: DateRange | null = null;
  if (
    predItemId &&
    predItemId !== itemId &&
    relationship &&
    (RELATIONSHIP_TYPES as string[]).includes(relationship) &&
    myDays !== null
  ) {
    const predItem = itemsById.get(predItemId);
    const predRange = predItem ? getItemDateRange(predItem, startId, durId, mode, holidays) : null;
    if (predRange) {
      scheduled = computeScheduledRange(predRange, myDays, relationship as RelationshipType, lag, mode, holidays);
    }
  }
  if (!scheduled && alwaysComputed && baseRange) {
    scheduled = baseRange;
  }
  if (!scheduled) return null;

  return {
    start: scheduled.start.toISOString().slice(0, 10),
    end: scheduled.end.toISOString().slice(0, 10),
    days: myDays,
  };
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Throws if this edit would push the item's schedule outside the window of
 * the nearest ancestor that has a schedule rule of its own (a Pred or a
 * manual start — see hasOwnScheduleRule). Such an ancestor is the authority
 * on its own dates, so everything underneath it has to finish inside them.
 *
 * Only guards edits a person makes to a schedule-driving cell; the engine's
 * own cascades (syncPredecessorSchedule) go around this deliberately, so a
 * recompute can never be blocked half-way. Silently returns whenever the
 * outcome can't be determined (no ancestor rule, no resolvable range),
 * rather than blocking on a guess.
 */
async function resolveAncestorScheduleWindow(
  boardId: string,
  itemId: string,
  /** When given, only these columns are treated as schedule-driving; an edit
   *  to anything else needs no check at all. */
  editedColumnId?: string
): Promise<{ name: string; start: string; end: string } | null> {
  const board = await prisma.board.findUnique({
    where: { id: boardId },
    select: {
      predColumnId: true,
      linkColumnId: true,
      lagColumnId: true,
      ganttStartColumnId: true,
      ganttDurationColumnId: true,
      ganttEndColumnId: true,
      ganttDurationMode: true,
      manualStartColumnId: true,
      manualDurationColumnId: true,
    },
  });
  if (!board?.ganttStartColumnId || !board.ganttDurationColumnId) return null;

  if (editedColumnId !== undefined) {
    const drivesSchedule = [
      board.predColumnId,
      board.linkColumnId,
      board.lagColumnId,
      board.ganttStartColumnId,
      board.ganttDurationColumnId,
      board.ganttEndColumnId,
      board.manualStartColumnId,
      board.manualDurationColumnId,
    ].includes(editedColumnId);
    if (!drivesSchedule) return null;
  }

  const ruleColumns = {
    predColumnId: board.predColumnId,
    manualStartColumnId: board.manualStartColumnId,
  };
  // Ancestors are always in the same group, so this stays group-scoped
  // rather than loading every item on the board.
  const self0 = await prisma.item.findUnique({ where: { id: itemId }, select: { groupId: true, parentId: true } });
  if (!self0?.parentId) return null;
  const items = await prisma.item.findMany({
    where: { groupId: self0.groupId },
    select: { id: true, parentId: true, name: true, cellValues: true },
  });
  const byId = new Map(items.map((i) => [i.id, i]));

  const self = byId.get(itemId);
  let ancestor = self?.parentId ? byId.get(self.parentId) : undefined;
  while (ancestor && !hasOwnScheduleRule(ancestor, ruleColumns)) {
    ancestor = ancestor.parentId ? byId.get(ancestor.parentId) : undefined;
  }
  if (!ancestor) return null;

  const holidays = toHolidaySet(await listHolidays());
  const window = getItemDateRange(
    ancestor,
    board.ganttStartColumnId,
    board.ganttDurationColumnId,
    board.ganttDurationMode,
    holidays
  );
  if (!window) return null;

  return { name: ancestor.name, start: isoDate(window.start), end: isoDate(window.end) };
}

function outOfWindowError(
  window: { name: string; start: string; end: string },
  start: string,
  end: string
): Error {
  return new Error(
    `超出上層「${window.name}」設定的時程 ${window.start} ~ ${window.end}:` +
      `此項目會變成 ${start} ~ ${end},請改在區間內,或先調整上層項目的時程。`
  );
}

/** Returns the reason this edit is rejected, or null when it's allowed.
 *  Returns rather than throws because Next.js redacts thrown Server Action
 *  errors in production — a thrown message never reaches the user. */
export async function checkScheduleWithinAncestorRule(
  boardId: string,
  itemId: string,
  columnId: string,
  newValue: string | number | null
): Promise<string | null> {
  const window = await resolveAncestorScheduleWindow(boardId, itemId, columnId);
  if (!window) return null;

  const preview = await previewScheduleChange(boardId, itemId, columnId, newValue);
  if (!preview) return null;

  if (preview.start < window.start || preview.end > window.end) {
    return outOfWindowError(window, preview.start, preview.end).message;
  }
  return null;
}

/** Same rule as assertScheduleWithinAncestorRule, for the Gantt drag paths,
 *  which already know the exact range the drag would produce. */
export async function assertRangeWithinAncestorRule(
  boardId: string,
  itemId: string,
  range: DateRange
): Promise<void> {
  const window = await resolveAncestorScheduleWindow(boardId, itemId);
  if (!window) return;

  const start = isoDate(range.start);
  const end = isoDate(range.end);
  if (start < window.start || end > window.end) {
    throw outOfWindowError(window, start, end);
  }
}

/**
 * Recomputes every Pred/Link-driven item on the board from scratch, in
 * dependency order (starting at each chain's root — an item with no
 * resolvable predecessor of its own — then cascading down), so the whole
 * board reflects its current Pred/Link/Lag/Days relationships. Used by the
 * Gantt view's manual "重算全部" button; never runs on its own.
 */
export async function recomputeAllSchedules(boardId: string): Promise<number> {
  const ctx = await buildScheduleContext(boardId);
  if (!ctx) return 0;

  const visited = new Set<string>();
  for (const item of ctx.items) {
    if (!ctx.predecessorOf(item.id)) {
      await ctx.recompute(item.id, visited);
    }
  }
  return visited.size;
}

/**
 * Rewrites a group's Pred cells from WBS codes to the item ids they resolve
 * to. Codes are what a spreadsheet import brings in, and they are positional:
 * once anything is inserted, deleted or re-ordered, every code below the
 * change points at a different task. Resolving them once, while the numbering
 * still matches the sheet, pins each reference to the task it meant.
 *
 * Idempotent — values already holding an id are left alone — and safe to run
 * on a board whose Pred column isn't configured (it does nothing).
 * Returns how many cells were rewritten.
 */
export async function normalizePredReferences(
  boardId: string,
  groupId?: string,
  client: Pick<typeof prisma, "board" | "item" | "cellValue"> = prisma
): Promise<number> {
  const board = await client.board.findUnique({ where: { id: boardId }, select: { predColumnId: true } });
  if (!board?.predColumnId) return 0;
  const predColumnId = board.predColumnId;

  const items = await client.item.findMany({
    where: groupId ? { groupId } : { boardId },
    select: { id: true, parentId: true, order: true, groupId: true, cellValues: true },
  });
  const index = buildWbsIndexFromItems(items);

  let rewritten = 0;
  for (const item of items) {
    const value = item.cellValues.find((cv) => cv.columnId === predColumnId)?.value;
    if (typeof value !== "string" || !value) continue;
    if (index.groupByItemId.get(value) === item.groupId) continue; // already an id
    const targetId = index.itemIdByGroupWbs.get(`${item.groupId}:${value}`);
    if (!targetId) continue; // dangling code — leave it for the user to see
    await client.cellValue.update({
      where: { itemId_columnId: { itemId: item.id, columnId: predColumnId } },
      data: { value: targetId },
    });
    rewritten++;
  }
  return rewritten;
}

/** One item that names another as its Pred, for the "相關項目" list. */
export type DependentSummary = {
  itemId: string;
  wbsCode: string;
  name: string;
  /** The relationship label (FS/FF/SS/SF), or null when Link isn't set. */
  link: string | null;
  start: string | null;
  end: string | null;
};

/**
 * Which items depend on this one, and on what terms — the other side of the
 * Pred field, which only ever says what an item points AT. Reads the stored
 * Start/Finish rather than recomputing: those cells are what scheduling
 * writes, so they are the dates actually in effect.
 *
 * Pure, so the item card and the assignment modal can both build the list
 * from the group they already have loaded.
 */
export function listDependentItems(
  itemId: string,
  groupItems: Pick<ItemData, "id" | "name" | "parentId" | "order" | "groupId" | "cellValues">[],
  columns: {
    predColumnId?: string | null;
    linkColumnId?: string | null;
    linkColumnOptions?: unknown;
    startColumnId?: string | null;
    endColumnId?: string | null;
  }
): DependentSummary[] {
  const { predColumnId, linkColumnId, startColumnId, endColumnId } = columns;
  if (!predColumnId) return [];
  const index = buildWbsIndexFromItems(groupItems);
  const linkOptions = linkColumnId ? getStatusOptions(columns.linkColumnOptions) : [];
  const text = (item: (typeof groupItems)[number], columnId?: string | null) => {
    if (!columnId) return null;
    const value = item.cellValues.find((cv) => cv.columnId === columnId)?.value;
    return typeof value === "string" && value ? value : null;
  };

  return groupItems
    .filter((candidate) => {
      if (candidate.id === itemId) return false;
      const value = text(candidate, predColumnId);
      return !!value && resolvePredValue(index, candidate.groupId, value) === itemId;
    })
    .map((candidate) => ({
      itemId: candidate.id,
      wbsCode: index.wbsByItemId.get(candidate.id) ?? "",
      name: candidate.name,
      link: linkOptions.find((o) => o.id === text(candidate, linkColumnId))?.label ?? null,
      start: text(candidate, startColumnId),
      end: text(candidate, endColumnId),
    }))
    .sort((a, b) => a.wbsCode.localeCompare(b.wbsCode, undefined, { numeric: true }));
}
