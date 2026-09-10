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

type NetworkColumns = {
  predColumnId: string | null;
  linkColumnId: string | null;
  linkColumnOptions?: unknown;
  lagColumnId: string | null;
  startColumnId: string | null;
  durationColumnId: string | null;
  durationMode: GanttDurationMode;
};

/**
 * Total float and the critical path for one group, by the standard CPM
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
  const result = new Map<string, ScheduleFloat>();
  const { predColumnId, linkColumnId, startColumnId, durationColumnId, durationMode } = columns;
  if (!predColumnId || !startColumnId || !durationColumnId) return result;

  const hasChildren = new Set(groupItems.map((i) => i.parentId).filter((id): id is string => !!id));
  const tasks = groupItems.filter((i) => !hasChildren.has(i.id));

  const early = new Map<string, DateRange>();
  for (const task of tasks) {
    const range = getItemDateRange(task, startColumnId, durationColumnId, durationMode, holidays);
    if (range) early.set(task.id, range);
  }
  if (early.size === 0) return result;

  const index = buildWbsIndexFromItems(groupItems);
  const linkOptions = linkColumnId ? getStatusOptions(columns.linkColumnOptions) : [];
  const byId = new Map(tasks.map((t) => [t.id, t]));

  const relationshipOf = (task: ItemData): RelationshipType | null => {
    const value = linkColumnId ? task.cellValues.find((cv) => cv.columnId === linkColumnId)?.value : null;
    const label = linkOptions.find((o) => o.id === value)?.label;
    return label && (RELATIONSHIPS as string[]).includes(label) ? (label as RelationshipType) : null;
  };
  const lagOf = (task: ItemData): number => {
    const value = columns.lagColumnId
      ? task.cellValues.find((cv) => cv.columnId === columns.lagColumnId)?.value
      : null;
    return typeof value === "number" ? value : 0;
  };
  const daysOf = (task: ItemData): number => {
    const range = early.get(task.id);
    if (!range) return 1;
    return countDaysInRange(range.start, range.end, durationMode, holidays) ?? 1;
  };

  // successor id -> the predecessors it waits on, and predecessor id -> its
  // successors, both restricted to tasks that are actually in the network.
  // Keyed by the edge, not just the successor: one successor can wait on
  // this task as FS and on another as SS, and the backward pass has to
  // invert the relationship that this particular edge carries.
  const successorsOf = new Map<string, { id: string; relationship: RelationshipType | null; lag: number | null }[]>();
  for (const task of tasks) {
    if (!early.has(task.id)) continue;
    const value = task.cellValues.find((cv) => cv.columnId === predColumnId)?.value;
    for (const entry of parsePredEntries(index, task.groupId, value)) {
      if (!early.has(entry.itemId)) continue;
      successorsOf.set(entry.itemId, [
        ...(successorsOf.get(entry.itemId) ?? []),
        { id: task.id, relationship: entry.relationship, lag: entry.lag },
      ]);
    }
  }

  // The project finishes when its last task does; anything with no successor
  // may run until then without delaying anything.
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
        durationMode,
        holidays
      );
      if (bound.end.getTime() < lateFinish.getTime()) lateFinish = bound.end;
    }
    const span = Math.max(daysOf(byId.get(id)!) - 1, 0);
    const late: DateRange = {
      start: shiftDate(lateFinish, -span, durationMode, holidays),
      end: lateFinish,
    };
    visiting.delete(id);
    lateCache.set(id, late);
    return late;
  }

  for (const [id, earlyRange] of early) {
    const late = lateRangeOf(id);
    // Inclusive day counts, so the shared day has to come back off. A late
    // finish before the early one means the item is already past its own
    // deadline — negative float, which is exactly what should be reported.
    const forward = countDaysInRange(earlyRange.end, late.end, durationMode, holidays);
    const backward = countDaysInRange(late.end, earlyRange.end, durationMode, holidays);
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
