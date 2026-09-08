import type { ItemData } from "@/types/board";
import type { DateRange } from "@/lib/gantt";

const DAY_MS = 86_400_000;

export type BaselineVariance = {
  start: Date;
  end: Date;
  days: number | null;
  /** Calendar days the current start moved: positive = later than planned. */
  startDelta: number;
  /** Calendar days the current finish moved: positive = late. */
  endDelta: number;
  /** What the finish變化 means, for colouring and counting. */
  status: "ahead" | "onTime" | "late";
};

function parseIso(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * How far an item has drifted from the plan that was saved for it.
 *
 * Deltas are calendar days, not working days: "延遲 5 天" is how people read a
 * slip, and a working-day count would report a weekend-spanning slip as
 * smaller than it feels. The schedule itself still runs on working days.
 *
 * Null when the item has no baseline (captured before it existed) or no
 * current range to compare — nothing to say either way.
 */
export function resolveBaselineVariance(
  item: Pick<ItemData, "baselineStart" | "baselineEnd" | "baselineDays">,
  currentRange: DateRange | null
): BaselineVariance | null {
  const start = parseIso(item.baselineStart);
  const end = parseIso(item.baselineEnd);
  if (!start || !end || !currentRange) return null;

  const startDelta = Math.round((currentRange.start.getTime() - start.getTime()) / DAY_MS);
  const endDelta = Math.round((currentRange.end.getTime() - end.getTime()) / DAY_MS);
  return {
    start,
    end,
    days: item.baselineDays,
    startDelta,
    endDelta,
    status: endDelta > 0 ? "late" : endDelta < 0 ? "ahead" : "onTime",
  };
}

/** "延遲 3 天" / "提前 2 天" / "準時" — the same wording everywhere it shows. */
export function describeBaselineDelta(delta: number): string {
  if (delta === 0) return "準時";
  return delta > 0 ? `延遲 ${delta} 天` : `提前 ${Math.abs(delta)} 天`;
}
