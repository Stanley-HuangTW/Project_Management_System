import type { GanttDurationMode } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getStatusOptions } from "@/types/column";
import type { ItemData } from "@/types/board";
import { getItemDateRange, hasOwnScheduleRule, type DateRange } from "@/lib/gantt";
import { endFromStartAndDays, shiftDate } from "@/lib/workday";
import { applyConstraint, constraintConflict, pinnedRange, pinsFinish } from "@/lib/constraints";
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
 * An id may name an item in ANY group of the same board: EVT waiting on a
 * POC deliverable is a real dependency, and refusing to record it only means
 * somebody keeps it in their head instead. The index is built from the whole
 * board, so "any group in the index" is exactly that.
 *
 * A WBS code is still accepted as a fallback, because that is what a
 * spreadsheet import brings in and what was stored before ids. Codes stay
 * group-scoped: they are positions within one group's own tree, so "1.2"
 * means a different task in every group and can only be read against the
 * referencing item's own.
 */
export function resolvePredValue(index: WbsIndex, groupId: string, value: string): string | undefined {
  if (index.groupByItemId.has(value)) return value;
  return index.itemIdByGroupWbs.get(`${groupId}:${value}`);
}

/**
 * Every item a Pred cell points at. A task can wait on more than one thing —
 * integration testing needs the software ported AND the mechanical sample
 * delivered — so the cell holds a comma-separated list, the same notation MS
 * Project uses ("12,15"). A single value is just a list of one, which is what
 * every board held before this and what a spreadsheet import still brings in.
 *
 * Unresolvable entries are dropped rather than reported: a reference to a
 * deleted item is simply not a dependency any more. Duplicates are collapsed,
 * and the referencing item can never be its own predecessor.
 */
export function resolvePredValues(index: WbsIndex, groupId: string, value: unknown): string[] {
  return parsePredEntries(index, groupId, value).map((entry) => entry.itemId);
}

/** One edge into an item: which predecessor, and — when this edge says so —
 *  its own relationship and lag rather than the item's Link/Lag columns. */
export type PredEntry = {
  itemId: string;
  /** Null means "use the item's own Link cell", which is what every entry
   *  written before per-edge relationships existed means. */
  relationship: RelationshipType | null;
  /** Null means "use the item's own Lag cell". */
  lag: number | null;
};

/**
 * A Pred entry, optionally carrying its own relationship and lag:
 * `<ref>`, `<ref>:FS`, `<ref>:SS-2`, `<ref>+3`.
 *
 * The relationship is separated by a colon rather than glued on MS Project
 * style ("12FS+3"): a reference here can be a cuid, and a cuid ending in
 * "ss" would otherwise parse as a Start-to-Start edge on an item nobody can
 * find. Every value written before this — a bare id, or a list of them —
 * still parses, and means exactly what it used to.
 */
const PRED_ENTRY_PATTERN = /^(.*?)(?::(FS|SS|FF|SF))?([+-]\d+)?$/i;

/**
 * Every edge a Pred cell describes. A task can wait on more than one thing —
 * integration testing needs the software ported AND the mechanical sample
 * delivered — so the cell holds a comma-separated list, the same notation MS
 * Project uses ("12,15").
 *
 * Unresolvable entries are dropped rather than reported: a reference to a
 * deleted item is simply not a dependency any more. Duplicates are collapsed
 * (the first one wins, so its relationship is the one kept), and the
 * referencing item can never be its own predecessor.
 */
/** Splits one entry into its reference and whatever it carries, without
 *  resolving the reference — the picker needs this before it has an index. */
export function splitPredEntry(part: string): {
  ref: string;
  relationship: RelationshipType | null;
  lag: number | null;
} {
  const match = PRED_ENTRY_PATTERN.exec(part.trim());
  if (!match) return { ref: part.trim(), relationship: null, lag: null };
  const [, ref, rel, lag] = match;
  return {
    ref: ref.trim(),
    relationship: rel ? (rel.toUpperCase() as RelationshipType) : null,
    lag: lag ? Number(lag) : null,
  };
}

export function parsePredEntries(index: WbsIndex, groupId: string, value: unknown): PredEntry[] {
  if (typeof value !== "string" || !value.trim()) return [];
  const entries: PredEntry[] = [];
  const seen = new Set<string>();
  for (const part of value.split(",")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const { ref, relationship, lag } = splitPredEntry(trimmed);
    const resolved = resolvePredValue(index, groupId, ref);
    if (!resolved || seen.has(resolved)) continue;
    seen.add(resolved);
    entries.push({ itemId: resolved, relationship, lag });
  }
  return entries;
}

/** The stored form of a Pred cell — null when nothing is selected, so the cell
 *  clears rather than holding an empty string. */
export function formatPredValue(itemIds: string[]): string | null {
  const unique = [...new Set(itemIds.filter(Boolean))];
  return unique.length > 0 ? unique.join(",") : null;
}

/** The stored form of a Pred cell with per-edge settings. An entry with
 *  neither is written as a bare id, so a board that never uses them keeps
 *  the same values it always had. */
export function formatPredEntries(entries: PredEntry[]): string | null {
  const parts: string[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    if (!entry.itemId || seen.has(entry.itemId)) continue;
    seen.add(entry.itemId);
    const rel = entry.relationship ? `:${entry.relationship}` : "";
    const lag = entry.lag ? `${entry.lag > 0 ? "+" : ""}${entry.lag}` : "";
    parts.push(`${entry.itemId}${rel}${lag}`);
  }
  return parts.length > 0 ? parts.join(",") : null;
}

export async function buildWbsIndex(boardId: string) {
  const items = await prisma.item.findMany({
    where: { boardId, deletedAt: null },
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

/** 這個項目是不是里程碑(Type 欄選的選項,標籤是 Milestone)。 */
export function isMilestoneItem(
  cellValues: { columnId: string; value: unknown }[],
  typeColumnId: string | null | undefined,
  typeOptions: ReturnType<typeof getStatusOptions>
): boolean {
  if (!typeColumnId) return false;
  const value = cellValues.find((cv) => cv.columnId === typeColumnId)?.value;
  return typeOptions.find((o) => o.id === value)?.label === "Milestone";
}

/**
 * 排程用的天數:算得出來(Days 欄或手動天數)就用;里程碑沒填的話是 0 天。
 * 里程碑的 Days 欄鎖在 0、使用者填不了,新建的里程碑那一格是空的——不能因為空白就算不出日期,
 * 不然設了 Pred 和 Link,Start / Finish 永遠是空的。
 */
export function scheduleDaysOf(days: number | null, milestone: boolean): number | null {
  return days !== null ? days : milestone ? 0 : null;
}

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
  items: (Pick<ItemData, "id" | "parentId" | "order" | "cellValues" | "groupId"> &
    Partial<Pick<ItemData, "constraintType" | "constraintDate">>)[],
  predColumnId?: string | null,
  linkColumnId?: string | null,
  linkColumnOptions?: unknown,
  typeColumnId?: string | null,
  typeColumnOptions?: unknown,
  manualStartColumnId?: string | null,
  manualDurationColumnId?: string | null
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
  const ownRuleColumns = { predColumnId };

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
      // One resolvable predecessor is enough: whichever end the relationship
      // drives is computed, no matter how many things this item waits on.
      const predIds = resolvePredValues(wbsIndex, item.groupId, predValue).filter(
        (predId) => predId !== item.id
      );
      if (predIds.length > 0) {
        const linkValue = item.cellValues.find((cv) => cv.columnId === linkColumnId)?.value;
        const label = linkOptions.find((o) => o.id === linkValue)?.label;
        if (label === "FS" || label === "SS") ensure(item.id).startLocked = true;
        else if (label === "FF" || label === "SF") ensure(item.id).endLocked = true;
      }
    }

    // 「必須完成於」把完成日釘死、開始日由天數往回推——兩端都是算出來的,
    // 手改任何一端都會在下次重算被蓋回去。要改請改約束日期或天數。
    if (pinsFinish({ type: item.constraintType ?? null, date: item.constraintDate ?? null })) {
      const lock = ensure(item.id);
      lock.startLocked = true;
      lock.endLocked = true;
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
/**
 * Everything one board contributes to the schedule: which columns hold the
 * dependency, the dates and the duration, and how it counts days.
 *
 * Per board rather than one set of ids, because a program spans boards and
 * each of them has its own columns — B 看板's "Pred" is a different column
 * from A 看板's, even though they are called the same thing.
 */
type BoardScheduleConfig = {
  predColumnId: string | null;
  linkColumnId: string | null;
  lagColumnId: string | null;
  startId: string;
  durId: string;
  endId: string | null;
  mode: GanttDurationMode;
  alwaysComputed: boolean;
  manualStartColumnId: string | null;
  manualDurationColumnId: string | null;
  linkOptions: ReturnType<typeof getStatusOptions>;
  typeColumnId: string | null;
  typeOptions: ReturnType<typeof getStatusOptions>;
};

async function loadBoardConfig(boardId: string): Promise<BoardScheduleConfig | null> {
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
      typeColumnId: true,
    },
  });
  if (!board?.ganttStartColumnId || !board.ganttDurationColumnId) return null;

  const alwaysComputed = !!board.manualStartColumnId && !!board.manualDurationColumnId;
  if (!alwaysComputed && (!board.predColumnId || !board.linkColumnId)) return null;

  const [linkColumn, typeColumn] = await Promise.all([
    board.linkColumnId
      ? prisma.column.findUnique({ where: { id: board.linkColumnId }, select: { options: true } })
      : null,
    board.typeColumnId
      ? prisma.column.findUnique({ where: { id: board.typeColumnId }, select: { options: true } })
      : null,
  ]);

  return {
    predColumnId: board.predColumnId,
    linkColumnId: board.linkColumnId,
    lagColumnId: board.lagColumnId,
    startId: board.ganttStartColumnId,
    durId: board.ganttDurationColumnId,
    endId: board.ganttEndColumnId,
    mode: board.ganttDurationMode,
    alwaysComputed,
    manualStartColumnId: board.manualStartColumnId,
    manualDurationColumnId: board.manualDurationColumnId,
    linkOptions: getStatusOptions(linkColumn?.options),
    typeColumnId: board.typeColumnId,
    typeOptions: getStatusOptions(typeColumn?.options),
  };
}

/**
 * The schedule network the edited board belongs to.
 *
 * A board in a 專案群組 shares one network with its siblings: a Pred may
 * point at an item on another board of the same program, and the cascade has
 * to follow it. A board with no program is its own network, exactly as
 * before. Every item is read and written through ITS OWN board's config.
 */
async function buildScheduleContext(
  boardId: string,
  /** Walk the cascade without touching the database — used to show the user
   *  which downstream items a drag would move, before it moves them. */
  dryRun = false
) {
  const own = await loadBoardConfig(boardId);
  // The edited board itself has to be schedulable; siblings that are not are
  // simply left out of the network rather than blocking it.
  if (!own) return null;

  const board = await prisma.board.findUnique({ where: { id: boardId }, select: { programId: true } });
  const siblingIds = board?.programId
    ? (
        await prisma.board.findMany({
          where: { programId: board.programId, id: { not: boardId }, deletedAt: null },
          select: { id: true },
        })
      ).map((b) => b.id)
    : [];

  const configByBoard = new Map<string, BoardScheduleConfig>([[boardId, own]]);
  for (const siblingId of siblingIds) {
    const config = await loadBoardConfig(siblingId);
    if (config) configByBoard.set(siblingId, config);
  }
  const boardIds = [...configByBoard.keys()];

  const [items, holidayRows] = await Promise.all([
    prisma.item.findMany({
      where: { boardId: { in: boardIds }, deletedAt: null },
      select: {
        id: true,
        name: true,
        parentId: true,
        order: true,
        cellValues: true,
        groupId: true,
        boardId: true,
        constraintType: true,
        constraintDate: true,
      },
    }),
    listHolidays(),
  ]);
  const holidays = toHolidaySet(holidayRows);
  const wbsIndex = buildWbsIndexFromItems(items);
  const { wbsByItemId } = wbsIndex;
  const itemsById = new Map(items.map((i) => [i.id, i]));
  const parentIds = new Set(items.map((i) => i.parentId).filter((id): id is string => !!id));

  /** The config of the board this item lives on. */
  const cfgOf = (item: { boardId: string }) => configByBoard.get(item.boardId)!;

  // Freshly-computed dates, so a dependent further down the chain reads its
  // predecessor's just-written dates without a mid-walk DB round trip.
  const overrides = new Map<string, DateRange>();

  function readRange(id: string): DateRange | null {
    if (overrides.has(id)) return overrides.get(id)!;
    const item = itemsById.get(id);
    if (!item) return null;
    const cfg = cfgOf(item);
    return getItemDateRange(item, cfg.startId, cfg.durId, cfg.mode, holidays);
  }

  async function writeRange(id: string, range: DateRange, days: number | null) {
    overrides.set(id, range);
    if (dryRun) return;
    const item = itemsById.get(id);
    if (!item) return;
    const cfg = cfgOf(item);
    const startIso = range.start.toISOString().slice(0, 10);
    await prisma.cellValue.upsert({
      where: { itemId_columnId: { itemId: id, columnId: cfg.startId } },
      create: { itemId: id, columnId: cfg.startId, value: startIso },
      update: { value: startIso },
    });
    if (cfg.endId) {
      const endIso = range.end.toISOString().slice(0, 10);
      await prisma.cellValue.upsert({
        where: { itemId_columnId: { itemId: id, columnId: cfg.endId } },
        create: { itemId: id, columnId: cfg.endId, value: endIso },
        update: { value: endIso },
      });
    }
    // Days is only ever a write target in "always computed" boards — in the
    // classic mode it's still the free manual input recompute reads from.
    // The one exception is a milestone whose Days cell was never filled in
    // (the cell is locked at 0, so nobody can fill it): it is written as 0, or
    // the Gantt, which needs a number there, could never draw its bar.
    const milestoneWithoutDays =
      !cfg.alwaysComputed &&
      typeof item.cellValues.find((cv) => cv.columnId === cfg.durId)?.value !== "number" &&
      isMilestoneItem(item.cellValues, cfg.typeColumnId, cfg.typeOptions);
    if ((cfg.alwaysComputed || milestoneWithoutDays) && days !== null) {
      await prisma.cellValue.upsert({
        where: { itemId_columnId: { itemId: id, columnId: cfg.durId } },
        create: { itemId: id, columnId: cfg.durId, value: days },
        update: { value: days },
      });
    }
  }

  function predecessorsOf(id: string): string[] {
    return predEntriesOf(id).map((entry) => entry.itemId);
  }

  /** The edges into this item, each with whatever relationship and lag it
   *  carries of its own — see parsePredEntries. */
  function predEntriesOf(id: string): PredEntry[] {
    const item = itemsById.get(id);
    if (!item) return [];
    const predColumnId = cfgOf(item).predColumnId;
    if (!predColumnId) return [];
    const predValue = item.cellValues.find((cv) => cv.columnId === predColumnId)?.value;
    return parsePredEntries(wbsIndex, item.groupId, predValue).filter((entry) => entry.itemId !== id);
  }

  function dependentsOf(id: string): string[] {
    if (!itemsById.has(id)) return [];
    // Resolved rather than string-compared: a Pred cell holds an item id now,
    // but may still hold a legacy WBS code — both have to find their target.
    //
    // Scanned across the whole network, not the item's own group or board: a
    // dependent may live in either, and stopping the cascade at that boundary
    // would leave it holding dates its predecessor no longer has. Each
    // candidate is read through its own board's Pred column.
    return items
      .filter((i) => {
        if (i.id === id) return false;
        const predColumnId = cfgOf(i).predColumnId;
        if (!predColumnId) return false;
        const value = i.cellValues.find((cv) => cv.columnId === predColumnId)?.value;
        return resolvePredValues(wbsIndex, i.groupId, value).includes(id);
      })
      .map((i) => i.id);
  }

  /** This item's own days-count and (in "always computed" mode only) its
   *  manual-column base range to fall back to when no predecessor applies. */
  function myDaysAndBase(item: (typeof items)[number]): { myDays: number | null; baseRange: DateRange | null } {
    const cfg = cfgOf(item);
    const milestone = isMilestoneItem(item.cellValues, cfg.typeColumnId, cfg.typeOptions);
    if (cfg.alwaysComputed) {
      const myDays = scheduleDaysOf(resolveScheduleDays(item.cellValues, cfg.manualDurationColumnId, cfg.durId), milestone);
      const baseRange = manualBaseRange(item.cellValues, cfg.manualStartColumnId!, myDays, cfg.mode, holidays);
      return { myDays, baseRange };
    }
    const daysValue = item.cellValues.find((cv) => cv.columnId === cfg.durId)?.value;
    return { myDays: scheduleDaysOf(typeof daysValue === "number" ? daysValue : null, milestone), baseRange: null };
  }

  /** This item's own length, its manual-column base range, and the range its
   *  predecessors alone would give it (before any date constraint). */
  function chainOf(item: (typeof items)[number]) {
    const cfg = cfgOf(item);
    const linkValue = cfg.linkColumnId
      ? item.cellValues.find((cv) => cv.columnId === cfg.linkColumnId)?.value
      : null;
    const fallbackRelationship = cfg.linkOptions.find((o) => o.id === linkValue)?.label;
    const lagValue = cfg.lagColumnId
      ? item.cellValues.find((cv) => cv.columnId === cfg.lagColumnId)?.value
      : null;
    const fallbackLag = typeof lagValue === "number" ? lagValue : 0;
    const { myDays, baseRange } = myDaysAndBase(item);
    const scheduled = scheduledFromPreds(
      predEntriesOf(item.id),
      fallbackRelationship,
      fallbackLag,
      myDays,
      cfg.mode,
      holidays,
      readRange
    );
    return { myDays, baseRange, scheduled };
  }

  /** Does this item's 必須完成於 fight its predecessors? Null when it doesn't
   *  (or there is nothing pinned). Reads the predecessors' stored dates. */
  function constraintConflictOf(id: string): string | null {
    const item = itemsById.get(id);
    if (!item) return null;
    const { myDays, scheduled } = chainOf(item);
    return constraintConflict(
      scheduled,
      myDays,
      { type: item.constraintType, date: item.constraintDate },
      cfgOf(item).mode,
      holidays
    );
  }

  async function recompute(id: string, visited: Set<string>) {
    if (visited.has(id)) return;
    visited.add(id);

    const item = itemsById.get(id);
    if (item) {
      const cfg = cfgOf(item);
      const { myDays, baseRange, scheduled } = chainOf(item);
      const constraint = { type: item.constraintType, date: item.constraintDate };
      // A finish date that is pinned needs no predecessor and no start(set):
      // the length alone counts the start back from it. Not for a summary that
      // follows its children — its dates are their span, not a length of its own.
      const followsChildren = parentIds.has(id) && !hasOwnScheduleRule(item, { predColumnId: cfg.predColumnId });
      const computed =
        scheduled ??
        (cfg.alwaysComputed ? baseRange : null) ??
        (followsChildren ? null : pinnedRange(myDays, constraint, cfg.mode, holidays));
      // A date the item has to respect whatever the chain wanted — a part that
      // does not arrive until the 15th, a demo that cannot move.
      const effective = computed
        ? applyConstraint(computed, myDays, constraint, cfg.mode, holidays).range
        : null;
      if (effective) await writeRange(id, effective, myDays);
    }

    for (const depId of dependentsOf(id)) {
      await recompute(depId, visited);
    }
  }

  // Triggers are matched against a column the user edited, which is always on
  // the board the edit came from.
  const ownTriggers = (
    own.alwaysComputed
      ? [own.predColumnId, own.linkColumnId, own.lagColumnId, own.manualDurationColumnId, own.manualStartColumnId, own.typeColumnId]
      : [own.predColumnId, own.linkColumnId, own.lagColumnId, own.durId, own.typeColumnId]
  ).filter((id): id is string => !!id);
  const cascadeTriggers = [own.startId, own.endId].filter((id): id is string => !!id);

  return {
    items,
    itemsById,
    wbsByItemId,
    overrides,
    /** Every board in this network — the caller has to refresh all of them. */
    boardIds,
    readRange,
    predecessorsOf,
    dependentsOf,
    recompute,
    constraintConflictOf,
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
  const self = await prisma.item.findUnique({ where: { id: itemId }, select: { id: true } });
  if (!self) return [];
  const ctx = await buildScheduleContext(boardId, true);
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
 * What would happen to the schedule if this item's Pred cell were set to
 * newValue: the item's own dates, and every item the cascade then moves. Runs
 * the real recompute (per-edge relationship and lag, constraints, the whole
 * Pred network) against an in-memory copy of the item — dry run, nothing is
 * written, so it can run while the user is still deciding.
 *
 * previewScheduleChange reads only the item's Link/Lag columns and so cannot
 * see a relationship that lives inside the Pred value itself; this can.
 */
export async function previewPredChange(
  boardId: string,
  itemId: string,
  predColumnId: string,
  newValue: string | null
): Promise<{ before: DateRange | null; after: DateRange | null; cascaded: CascadedItem[] } | null> {
  const ctx = await buildScheduleContext(boardId, true);
  if (!ctx) return null;
  const item = ctx.itemsById.get(itemId);
  if (!item) return null;

  const before = new Map<string, DateRange>();
  for (const candidate of ctx.items) {
    const current = ctx.readRange(candidate.id);
    if (current) before.set(candidate.id, current);
  }

  const edited = item.cellValues.find((cv) => cv.columnId === predColumnId);
  item.cellValues = [
    ...item.cellValues.filter((cv) => cv.columnId !== predColumnId),
    { id: edited?.id ?? "preview", itemId, columnId: predColumnId, value: newValue },
  ];
  await ctx.recompute(itemId, new Set());

  const own = ctx.overrides.get(itemId) ?? null;
  const cascaded: CascadedItem[] = [];
  for (const [id, next] of ctx.overrides) {
    if (id === itemId) continue;
    const previous = before.get(id);
    if (previous && isoDay(previous.start) === isoDay(next.start) && isoDay(previous.end) === isoDay(next.end)) continue;
    cascaded.push({
      itemId: id,
      name: ctx.itemsById.get(id)?.name ?? "",
      wbsCode: ctx.wbsByItemId.get(id) ?? "",
      oldStart: previous ? isoDay(previous.start) : "-",
      oldEnd: previous ? isoDay(previous.end) : "-",
      newStart: isoDay(next.start),
      newEnd: isoDay(next.end),
    });
  }
  cascaded.sort((a, b) => a.wbsCode.localeCompare(b.wbsCode, undefined, { numeric: true }));
  return { before: before.get(itemId) ?? null, after: own, cascaded };
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
      typeColumnId: true,
    },
  });
  if (!board) return new Set();
  const alwaysComputed = !!board.manualStartColumnId && !!board.manualDurationColumnId;
  const own = alwaysComputed
    ? [board.predColumnId, board.linkColumnId, board.lagColumnId, board.manualDurationColumnId, board.manualStartColumnId, board.typeColumnId]
    : [board.predColumnId, board.linkColumnId, board.lagColumnId, board.ganttDurationColumnId, board.typeColumnId];
  return new Set(
    [...own, board.ganttStartColumnId, board.ganttEndColumnId].filter((id): id is string => !!id)
  );
}

export async function syncPredecessorSchedule(
  boardId: string,
  itemId: string,
  editedColumnId: string
): Promise<string[]> {
  const triggers = await scheduleTriggerColumnIds(boardId);
  if (!triggers.has(editedColumnId)) return [boardId];

  const ctx = await buildScheduleContext(boardId);
  if (!ctx) return [boardId];
  if (!ctx.ownTriggers.includes(editedColumnId) && !ctx.cascadeTriggers.includes(editedColumnId)) {
    return [boardId];
  }

  if (ctx.ownTriggers.includes(editedColumnId)) {
    await ctx.recompute(itemId, new Set());
  } else {
    const visited = new Set([itemId]);
    for (const depId of ctx.dependentsOf(itemId)) await ctx.recompute(depId, visited);
  }

  return ctx.boardIds;
}

export type ConstraintConflict = { itemId: string; name: string; message: string };

/**
 * 「必須完成於」跟前置依賴打架的項目:這個項目自己,加上(downstream)它後面接著排的所有項目——
 * 改了一個項目的日期,後面某個被釘住的項目可能就被推到約束之外,改的人要知道。
 * editedColumnId 給了就先看那一欄會不會動到時程,不會就不用把整個看板載進來算。
 * 在排程重算之後呼叫:比的是前置依賴「現在存著」的日期。
 */
export async function findConstraintConflicts(
  boardId: string,
  itemId: string,
  options: { editedColumnId?: string; downstream?: boolean } = {}
): Promise<ConstraintConflict[]> {
  if (options.editedColumnId !== undefined) {
    const triggers = await scheduleTriggerColumnIds(boardId);
    if (!triggers.has(options.editedColumnId)) return [];
  }
  const ctx = await buildScheduleContext(boardId, true);
  if (!ctx) return [];

  const ids = [itemId];
  if (options.downstream) {
    const seen = new Set(ids);
    for (let i = 0; i < ids.length; i++) {
      for (const depId of ctx.dependentsOf(ids[i])) {
        if (!seen.has(depId)) {
          seen.add(depId);
          ids.push(depId);
        }
      }
    }
  }
  const conflicts: ConstraintConflict[] = [];
  for (const id of ids) {
    const message = ctx.constraintConflictOf(id);
    if (message) conflicts.push({ itemId: id, name: ctx.itemsById.get(id)?.name ?? "", message });
  }
  return conflicts;
}

/** The conflicts as one message for a dialog: the edited item's own first, the
 *  downstream ones named, and a cap so a long chain doesn't fill the screen. */
export function describeConstraintConflicts(conflicts: ConstraintConflict[], ownItemId: string, limit = 3): string {
  const lines = conflicts
    .slice()
    .sort((a, b) => Number(b.itemId === ownItemId) - Number(a.itemId === ownItemId))
    .map((c) => (c.itemId === ownItemId ? c.message : `「${c.name}」:${c.message}`));
  const shown = lines.slice(0, limit);
  if (lines.length > limit) shown.push(`…另有 ${lines.length - limit} 個項目也有同樣的衝突`);
  return shown.join("\n\n");
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
      typeColumnId: true,
    },
  });
  if (!board) return null;
  const {
    typeColumnId,
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

  const self = await prisma.item.findUnique({ where: { id: itemId }, select: { groupId: true, boardId: true } });
  if (!self) return null;
  const [linkColumn, typeColumn, items, holidayRows] = await Promise.all([
    linkColumnId
      ? prisma.column.findUnique({ where: { id: linkColumnId }, select: { options: true } })
      : Promise.resolve(null),
    typeColumnId
      ? prisma.column.findUnique({ where: { id: typeColumnId }, select: { options: true } })
      : Promise.resolve(null),
    // Group-scoped: a Pred reference resolves within the item's own group.
    prisma.item.findMany({
      // Board-wide: a predecessor may live in another group.
      where: { boardId: self.boardId, deletedAt: null },
      select: {
        id: true,
        parentId: true,
        order: true,
        cellValues: true,
        groupId: true,
        constraintType: true,
        constraintDate: true,
      },
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
  const predItemIds = predColumnId
    ? resolvePredValues(wbsIndex, item.groupId, predValue).filter((predId) => predId !== itemId)
    : [];
  const linkValue = linkColumnId ? cellValues.find((cv) => cv.columnId === linkColumnId)?.value : null;
  const relationship = linkOptions.find((o) => o.id === linkValue)?.label;
  const lagValue = lagColumnId ? cellValues.find((cv) => cv.columnId === lagColumnId)?.value : null;
  const lag = typeof lagValue === "number" ? lagValue : 0;

  const milestone = isMilestoneItem(cellValues, typeColumnId, getStatusOptions(typeColumn?.options));
  let myDays: number | null;
  let baseRange: DateRange | null = null;
  if (alwaysComputed) {
    myDays = scheduleDaysOf(resolveScheduleDays(cellValues, manualDurationColumnId, durId), milestone);
    baseRange = manualBaseRange(cellValues, manualStartColumnId!, myDays, mode, holidays);
  } else {
    const daysValue = cellValues.find((cv) => cv.columnId === durId)?.value;
    myDays = scheduleDaysOf(typeof daysValue === "number" ? daysValue : null, milestone);
  }

  let scheduled: DateRange | null = null;
  if (relationship && (RELATIONSHIP_TYPES as string[]).includes(relationship) && myDays !== null) {
    // Same rule as recompute: the binding predecessor is the one that pushes
    // this item latest.
    scheduled = pickLatest(
      predItemIds.map((predItemId) => {
        const predItem = itemsById.get(predItemId);
        const predRange = predItem ? getItemDateRange(predItem, startId, durId, mode, holidays) : null;
        return predRange
          ? computeScheduledRange(predRange, myDays, relationship as RelationshipType, lag, mode, holidays)
          : null;
      })
    );
  }
  if (!scheduled && alwaysComputed && baseRange) {
    scheduled = baseRange;
  }
  const constraint = { type: item.constraintType, date: item.constraintDate };
  if (!scheduled) scheduled = pinnedRange(myDays, constraint, mode, holidays);
  if (!scheduled) return null;
  // Same constraint the real recompute applies, so the preview shows the dates
  // that will actually be written rather than the unconstrained ones.
  scheduled = applyConstraint(scheduled, myDays, constraint, mode, holidays).range;

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

  const ruleColumns = { predColumnId: board.predColumnId };
  // Ancestors are always in the same group, so this stays group-scoped
  // rather than loading every item on the board.
  const self0 = await prisma.item.findUnique({ where: { id: itemId }, select: { groupId: true, parentId: true, boardId: true } });
  if (!self0?.parentId) return null;
  const items = await prisma.item.findMany({
    where: { boardId: self0.boardId, deletedAt: null },
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
export async function recomputeAllSchedules(
  boardId: string
): Promise<{ count: number; boardIds: string[] }> {
  const ctx = await buildScheduleContext(boardId);
  if (!ctx) return { count: 0, boardIds: [boardId] };

  const visited = new Set<string>();
  for (const item of ctx.items) {
    if (ctx.predecessorsOf(item.id).length === 0) {
      await ctx.recompute(item.id, visited);
    }
  }
  return { count: visited.size, boardIds: ctx.boardIds };
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
    where: groupId ? { groupId, deletedAt: null } : { boardId, deletedAt: null },
    select: { id: true, parentId: true, order: true, groupId: true, cellValues: true },
  });
  const index = buildWbsIndexFromItems(items);

  let rewritten = 0;
  for (const item of items) {
    const value = item.cellValues.find((cv) => cv.columnId === predColumnId)?.value;
    if (typeof value !== "string" || !value.trim()) continue;
    // Each entry independently: a list can mix an already-pinned id with a
    // freshly imported code.
    const parts = value.split(",").map((p) => p.trim()).filter(Boolean);
    const pinned = parts.map((part) => {
      // Only the reference is rewritten; the ":FS+3" an edge may carry is
      // its own setting and has to survive the pinning untouched.
      const match = PRED_ENTRY_PATTERN.exec(part);
      const ref = (match?.[1] ?? part).trim();
      const suffix = part.slice(ref.length);
      // Already an id — in any group. Only codes need pinning.
      if (index.groupByItemId.has(ref)) return part;
      const resolved = index.itemIdByGroupWbs.get(`${item.groupId}:${ref}`);
      return resolved ? resolved + suffix : part;
    });
    const next = pinned.join(",");
    if (next === value) continue; // nothing resolvable, or all already ids
    await client.cellValue.update({
      where: { itemId_columnId: { itemId: item.id, columnId: predColumnId } },
      data: { value: next },
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
    .flatMap((candidate) => {
      if (candidate.id === itemId) return [];
      const value = text(candidate, predColumnId);
      const edge = parsePredEntries(index, candidate.groupId, value).find((e) => e.itemId === itemId);
      if (!edge) return [];
      return [{ candidate, edge }];
    })
    .map(({ candidate, edge }) => ({
      itemId: candidate.id,
      wbsCode: index.wbsByItemId.get(candidate.id) ?? "",
      name: candidate.name,
      // The relationship on THIS edge, not whatever the dependent's Link
      // column says about its other predecessors.
      link: edge.relationship ?? linkOptions.find((o) => o.id === text(candidate, linkColumnId))?.label ?? null,
      start: text(candidate, startColumnId),
      end: text(candidate, endColumnId),
    }))
    .sort((a, b) => a.wbsCode.localeCompare(b.wbsCode, undefined, { numeric: true }));
}

/**
 * The range an item's predecessors alone would give it, before any date
 * constraint. With several predecessors the binding one is whichever pushes
 * this item latest — you cannot start until the last thing you wait on is out
 * of the way. Each edge uses its own relationship and lag when the Pred cell
 * gives it one, and the item's Link/Lag columns when it does not: one task
 * can wait for the sample to ship (FS) and for the test rig to be free (SS)
 * at the same time.
 */
export function scheduledFromPreds(
  entries: PredEntry[],
  fallbackRelationship: string | undefined,
  fallbackLag: number,
  myDays: number | null,
  mode: GanttDurationMode,
  holidays: Set<string>,
  readRange: (itemId: string) => DateRange | null
): DateRange | null {
  return pickLatest(
    entries.map((entry) => {
      const relationship = entry.relationship ?? fallbackRelationship;
      const lag = entry.lag ?? fallbackLag;
      if (!relationship || !(RELATIONSHIP_TYPES as string[]).includes(relationship) || myDays === null) {
        return null;
      }
      const predRange = readRange(entry.itemId);
      if (!predRange) return null;
      return computeScheduledRange(predRange, myDays, relationship as RelationshipType, lag, mode, holidays);
    })
  );
}

/**
 * Of several candidate ranges, the one that starts latest — the predecessor
 * that actually constrains this item. All candidates share the same duration,
 * so the latest start is also the latest finish; nulls (a predecessor with no
 * dates of its own yet) simply do not constrain anything.
 */
export function pickLatest(candidates: (DateRange | null)[]): DateRange | null {
  let latest: DateRange | null = null;
  for (const candidate of candidates) {
    if (!candidate) continue;
    if (!latest || candidate.start.getTime() > latest.start.getTime()) latest = candidate;
  }
  return latest;
}
