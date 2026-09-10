/**
 * The S-curve: how much of the project was meant to be finished by each
 * week, against how much actually is.
 *
 * Three series, because a project report has to answer three different
 * questions and they are not the same one:
 *
 *  - 計畫 comes from the baseline — the plan as it was signed off. It never
 *    moves, which is what makes it worth plotting.
 *  - 目前排程 comes from today's dates. Where it sits above or below 計畫 is
 *    the slip (or the pull-in) the scheduler has already absorbed.
 *  - 實際 counts only what is actually finished, and stops at today —
 *    drawing it into the future would be forecasting, which is what 目前排程
 *    already does.
 */

export type CurveTask = {
  /** When the plan said this would finish. Null when it has no baseline. */
  baselineEnd: string | null;
  /** When it is currently scheduled to finish. Null when it has no dates. */
  scheduledEnd: string | null;
  /** True once the task counts as finished — the board's own 已完成 bucket. */
  isDone: boolean;
};

export type CurvePoint = {
  /** The week this point closes, as YYYY-MM-DD. */
  iso: string;
  planned: number;
  scheduled: number;
  /** Null after today: nothing has actually happened there yet. */
  actual: number | null;
};

export type ProgressCurve = {
  points: CurvePoint[];
  total: number;
  /** False when no task carries a baseline — the 計畫 line is then flat zero
   *  and the caller should say so rather than draw a lie. */
  hasBaseline: boolean;
};

const DAY_MS = 86_400_000;

function parseIso(value: string | null): number | null {
  if (!value) return null;
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : time;
}

function toIso(time: number): string {
  return new Date(time).toISOString().slice(0, 10);
}

/**
 * Weekly cumulative counts across the whole span the project covers, plan
 * and current schedule together.
 *
 * Weekly rather than daily: a hardware NPI runs over a year or more, and a
 * daily curve is 400 points of noise on a chart 600 pixels wide.
 */
export function computeProgressCurve(tasks: CurveTask[], todayIso: string): ProgressCurve {
  const total = tasks.length;
  const today = parseIso(todayIso) ?? Date.now();
  if (total === 0) return { points: [], total: 0, hasBaseline: false };

  const baselineEnds = tasks.map((t) => parseIso(t.baselineEnd));
  const scheduledEnds = tasks.map((t) => parseIso(t.scheduledEnd));
  const known = [...baselineEnds, ...scheduledEnds].filter((t): t is number => t !== null);
  if (known.length === 0) return { points: [], total, hasBaseline: false };

  // The span has to include today even when every date is in the past, or a
  // finished project's 實際 line stops short of the edge of the chart.
  const first = Math.min(...known);
  const last = Math.max(Math.max(...known), today);

  const points: CurvePoint[] = [];
  for (let cursor = first; cursor <= last + DAY_MS * 7; cursor += DAY_MS * 7) {
    const at = Math.min(cursor, last);
    points.push({
      iso: toIso(at),
      planned: baselineEnds.filter((t) => t !== null && t <= at).length,
      scheduled: scheduledEnds.filter((t) => t !== null && t <= at).length,
      actual:
        at <= today
          ? tasks.filter((t, i) => t.isDone && scheduledEnds[i] !== null && scheduledEnds[i]! <= at).length
          : null,
    });
    if (at === last) break;
  }

  return { points, total, hasBaseline: baselineEnds.some((t) => t !== null) };
}

/** Percent of `total`, rounded to one decimal — what the chart's Y axis
 *  actually plots, so a 500-task board and a 12-task one read the same. */
export function toPercent(count: number, total: number): number {
  if (total === 0) return 0;
  return Math.round((count / total) * 1000) / 10;
}
