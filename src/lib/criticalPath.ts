import type { GanttDurationMode } from "@prisma/client";
import type { ItemData } from "@/types/board";
import { getItemDateRange, type DateRange } from "@/lib/gantt";
import { countDaysInRange, shiftDate } from "@/lib/workday";
import {
  buildWbsIndexFromItems,
  parsePredEntries,
  type RelationshipType,
} from "@/lib/predecessorLink";
import { getStatusOptions } from "@/types/column";

export type ScheduleFloat = {
  /** Working days this item's finish can slip before the project's does. */
  totalFloat: number;
  /** Zero float — slipping this task slips the whole project. */
  isCritical: boolean;
  lateStart: Date;
  lateFinish: Date;
};

const RELATIONSHIPS: RelationshipType[] = ["FS", "FF", "SS", "SF"];

/**
 * The latest a predecessor may run without pushing this successor past its own
 * late dates — the inverse of computeScheduledRange, which derives a successor
 * from its predecessor. Each relationship anchors a different pair of ends, so
 * each inverts differently:
 *
 *   FS  successor starts after predecessor finishes  → pred finishes 1+lag before
 *   SS  successor starts with predecessor's start    → pred starts lag before
 *   FF  successor finishes with predecessor's finish → pred finishes lag before
 *   SF  successor finishes after predecessor starts  → pred starts lag before
 */
function latestPredecessorRange(
  successorLate: DateRange,
  predDays: number,
  relationship: RelationshipType,
  lag: number,
  mode: GanttDurationMode,
  holidays: Set<string>
): DateRange {
  const span = Math.max(Math.round(predDays) - 1, 0);
  if (relationship === "FS") {
    const end = shiftDate(successorLate.start, -(1 + lag), mode, holidays);
    return { start: shiftDate(end, -span, mode, holidays), end };
  }
  if (relationship === "SS") {
    const start = shiftDate(successorLate.start, -lag, mode, holidays);
    return { start, end: shiftDate(start, span, mode, holidays) };
  }
  if (relationship === "FF") {
    const end = shiftDate(successorLate.end, -lag, mode, holidays);
    return { start: shiftDate(end, -span, mode, holidays), end };
  }
  const start = shiftDate(successorLate.end, -lag, mode, holidays);
  return { start, end: shiftDate(start, span, mode, holidays) };
}
export type NetworkColumns = {
  predColumnId: string | null;
  linkColumnId: string | null;
  linkColumnOptions?: unknown;
  lagColumnId: string | null;
  startColumnId: string | null;
  durationColumnId: string | null;
  durationMode: GanttDurationMode;
};

/**
 * Total float and the critical path for one board, by the standard CPM
 * backward pass.
 *
 * The forward pass is already done — the scheduler wrote each item's
 * Start/Finish, which are its early dates. This walks the network backwards
 * from the project finish: an item with nothing depending on it may run until
 * the project ends, and anything else must finish early enough for every one
 * of its successors. The gap between an item's early finish and that late
 * finish is its float; zero float means slipping it slips the whole project.
 *
 * Only leaf tasks take part. A summary's dates are a roll-up of its children,
 * so giving it float of its own would double-count the subtree that already
 * has it. Items with no dates are skipped — they are not in the network.
 */
export function computeCriticalPath(
  groupItems: ItemData[],
  columns: NetworkColumns,
  holidays: Set<string>
): Map<string, ScheduleFloat> {
  return computeCriticalPathAcross(groupItems, () => columns, holidays);
}

/**
 * The same backward pass over a network that spans several boards — a
 * 專案群組, where a Pred may point at an item on a sibling board.
 *
 * What makes it a different function is that there is no single column
 * configuration: each board names and holds its Pred/Link/Start/Days columns
 * separately, so every item has to be read through its own board's. An item
 * whose board is not set up for scheduling is left out of the network rather
 * than read through somebody else's columns.
 *
 * The float it produces is the float against the WHOLE group's finish, which
 * is the point: a task with a week of slack inside its own board has none if
 * the next board is waiting on it.
 */
export function computeCriticalPathAcross(
  items: ItemData[],
  columnsOf: (item: ItemData) => NetworkColumns | null,
  holidays: Set<string>
): Map<string, ScheduleFloat> {
  const result = new Map<string, ScheduleFloat>();

  const hasChildren = new Set(items.map((i) => i.parentId).filter((id): id is string => !!id));
  const configOf = new Map<string, NetworkColumns>();
  const tasks: ItemData[] = [];
  for (const item of items) {
    if (hasChildren.has(item.id)) continue;
    const columns = columnsOf(item);
    if (!columns?.predColumnId || !columns.startColumnId || !columns.durationColumnId) continue;
    configOf.set(item.id, columns);
    tasks.push(item);
  }
  if (tasks.length === 0) return result;

  const cfg = (id: string) => configOf.get(id)!;

  const early = new Map<string, DateRange>();
  for (const task of tasks) {
    const columns = cfg(task.id);
    const range = getItemDateRange(
      task,
      columns.startColumnId!,
      columns.durationColumnId!,
      columns.durationMode,
      holidays
    );
    if (range) early.set(task.id, range);
  }
  if (early.size === 0) return result;

  // Built from every item, not just the tasks: a Pred may name a summary's
  // WBS code, and the index is what turns that code into an id.
  const index = buildWbsIndexFromItems(items);
  const byId = new Map(tasks.map((t) => [t.id, t]));

  const optionsCache = new Map<string, ReturnType<typeof getStatusOptions>>();
  const linkOptionsFor = (id: string) => {
    const columns = cfg(id);
    if (!columns.linkColumnId) return [];
    const cached = optionsCache.get(columns.linkColumnId);
    if (cached) return cached;
    const options = getStatusOptions(columns.linkColumnOptions);
    optionsCache.set(columns.linkColumnId, options);
    return options;
  };

  const relationshipOf = (task: ItemData): RelationshipType | null => {
    const columns = cfg(task.id);
    const value = columns.linkColumnId
      ? task.cellValues.find((cv) => cv.columnId === columns.linkColumnId)?.value
      : null;
    const label = linkOptionsFor(task.id).find((o) => o.id === value)?.label;
    return label && (RELATIONSHIPS as string[]).includes(label) ? (label as RelationshipType) : null;
  };
  const lagOf = (task: ItemData): number => {
    const columns = cfg(task.id);
    const value = columns.lagColumnId
      ? task.cellValues.find((cv) => cv.columnId === columns.lagColumnId)?.value
      : null;
    return typeof value === "number" ? value : 0;
  };
  const daysOf = (task: ItemData): number => {
    const range = early.get(task.id);
    if (!range) return 1;
    return countDaysInRange(range.start, range.end, cfg(task.id).durationMode, holidays) ?? 1;
  };

  // successor id -> the predecessors it waits on, and predecessor id -> its
  // successors, both restricted to tasks that are actually in the network.
  // Keyed by the edge, not just the successor: one successor can wait on
  // this task as FS and on another as SS, and the backward pass has to
  // invert the relationship that this particular edge carries.
  const successorsOf = new Map<string, { id: string; relationship: RelationshipType | null; lag: number | null }[]>();
  for (const task of tasks) {
    if (!early.has(task.id)) continue;
    const value = task.cellValues.find((cv) => cv.columnId === cfg(task.id).predColumnId)?.value;
    for (const entry of parsePredEntries(index, task.groupId, value)) {
      if (!early.has(entry.itemId)) continue;
      successorsOf.set(entry.itemId, [
        ...(successorsOf.get(entry.itemId) ?? []),
        { id: task.id, relationship: entry.relationship, lag: entry.lag },
      ]);
    }
  }

  // The project finishes when its last task does; anything with no successor
  // may run until then without delaying anything. Across a group that last
  // task may be on any of its boards — which is exactly why a board's own
  // float understates how tight it is.
  const projectFinish = [...early.values()].reduce(
    (latest, range) => (range.end.getTime() > latest.getTime() ? range.end : latest),
    [...early.values()][0].end
  );

  const lateCache = new Map<string, DateRange>();
  const visiting = new Set<string>();

  function lateRangeOf(id: string): DateRange {
    const cached = lateCache.get(id);
    if (cached) return cached;
    const range = early.get(id)!;
    // A circular Pred chain would recurse forever; treat the item as if it
    // constrained nothing rather than hanging the whole board.
    if (visiting.has(id)) return range;
    visiting.add(id);

    const mode = cfg(id).durationMode;
    const successors = successorsOf.get(id) ?? [];
    let lateFinish = projectFinish;
    for (const edge of successors) {
      const successor = byId.get(edge.id);
      const relationship = edge.relationship ?? (successor ? relationshipOf(successor) : null);
      if (!successor || !relationship) continue;
      const bound = latestPredecessorRange(
        lateRangeOf(edge.id),
        daysOf(byId.get(id)!),
        relationship,
        edge.lag ?? lagOf(successor),
        mode,
        holidays
      );
      if (bound.end.getTime() < lateFinish.getTime()) lateFinish = bound.end;
    }
    const span = Math.max(daysOf(byId.get(id)!) - 1, 0);
    const late: DateRange = {
      start: shiftDate(lateFinish, -span, mode, holidays),
      end: lateFinish,
    };
    visiting.delete(id);
    lateCache.set(id, late);
    return late;
  }

  for (const [id, earlyRange] of early) {
    const late = lateRangeOf(id);
    const mode = cfg(id).durationMode;
    // Inclusive day counts, so the shared day has to come back off. A late
    // finish before the early one means the item is already past its own
    // deadline — negative float, which is exactly what should be reported.
    const forward = countDaysInRange(earlyRange.end, late.end, mode, holidays);
    const backward = countDaysInRange(late.end, earlyRange.end, mode, holidays);
    const totalFloat =
      forward !== null ? forward - 1 : backward !== null ? -(backward - 1) : 0;
    result.set(id, {
      totalFloat,
      isCritical: totalFloat <= 0,
      lateStart: late.start,
      lateFinish: late.end,
    });
  }
  return result;
}
