import type { GanttDurationMode, ItemConstraintType } from "@prisma/client";
import type { DateRange } from "@/lib/gantt";
import { shiftDate } from "@/lib/workday";

export type ItemConstraint = {
  type: ItemConstraintType | null;
  /** "YYYY-MM-DD" — meaningless without a type. */
  date: string | null;
};

export type ConstrainedRange = {
  range: DateRange;
  /** Set when the schedule cannot honour the constraint — a deadline the work
   *  already runs past. Null when there is nothing to report. */
  violation: string | null;
};

export const CONSTRAINT_LABELS: Record<ItemConstraintType, string> = {
  START_NO_EARLIER_THAN: "不得早於(開始)",
  FINISH_NO_LATER_THAN: "不得晚於(完成)",
  MUST_FINISH_ON: "必須完成於",
};

function parseIso(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Applies an item's date constraint to the range its predecessors produced.
 *
 * The three types behave differently on purpose:
 *
 *  - START_NO_EARLIER_THAN moves the item later when the chain would have
 *    started it too soon. A part that does not arrive until the 15th cannot
 *    be worked on the 12th, however free the schedule is.
 *  - MUST_FINISH_ON pins the finish and derives the start backwards. This
 *    overrides the chain in both directions — it is the fixed date everything
 *    else is arranged around.
 *  - FINISH_NO_LATER_THAN does NOT move anything. A deadline does not make
 *    work go faster; missing it is a fact to report, not a date to rewrite.
 *    Silently pulling the item earlier would break its predecessors and hide
 *    the very problem the deadline exists to surface.
 */
export function applyConstraint(
  range: DateRange,
  days: number | null,
  constraint: ItemConstraint,
  mode: GanttDurationMode,
  holidays: Set<string>
): ConstrainedRange {
  const date = parseIso(constraint.date);
  if (!constraint.type || !date) return { range, violation: null };
  const span = Math.max(Math.round(days ?? 1) - 1, 0);
  const iso = (d: Date) => d.toISOString().slice(0, 10);

  if (constraint.type === "START_NO_EARLIER_THAN") {
    if (range.start.getTime() >= date.getTime()) return { range, violation: null };
    return {
      range: { start: date, end: shiftDate(date, span, mode, holidays) },
      violation: null,
    };
  }

  if (constraint.type === "MUST_FINISH_ON") {
    return {
      range: { start: shiftDate(date, -span, mode, holidays), end: date },
      violation: null,
    };
  }

  // FINISH_NO_LATER_THAN
  if (range.end.getTime() <= date.getTime()) return { range, violation: null };
  return {
    range,
    violation: `完成日 ${iso(range.end)} 已超過「不得晚於 ${iso(date)}」的期限`,
  };
}

/** The constraint as a sentence, for the item card and the Gantt's hover. */
export function describeConstraint(constraint: ItemConstraint): string | null {
  if (!constraint.type || !constraint.date) return null;
  return `${CONSTRAINT_LABELS[constraint.type]} ${constraint.date}`;
}
