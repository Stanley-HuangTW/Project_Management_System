/**
 * 預算預估 — 照這樣下去會花多少,而不是已經花了多少。
 *
 * 預算管控 (budget.ts) does subtraction: approved minus spent minus committed.
 * That answers "have we run out yet". This answers the question a month
 * earlier — at the rate this is going, what will the total be, and is it
 * already past what was approved?
 */

const DAY_MS = 86_400_000;
const WEEK_MS = DAY_MS * 7;

export type DatedAmount = { date: string | null; amount: number };

export type SpendPoint = {
  /** The week this point closes. */
  iso: string;
  /** 累積計畫支出:核准預算依排程直線攤提。Null when the scope has no dates
   *  to spread it across. */
  planned: number | null;
  /** 累積實際支出。Null after today — nothing has happened there yet. */
  actual: number | null;
  /** 累積實際 + 已承諾,按 PO 的預計入帳日往前推。This is the line that
   *  crosses the budget first, and the only one that does it early enough to
   *  act on. */
  committed: number;
};

export type BudgetForecast = {
  points: SpendPoint[];
  budget: number;
  /** 已花費 + 已承諾 — the money that is gone either way. */
  engaged: number;
  /** 0–1. Null when nothing says how far along the work is. */
  fractionDone: number | null;
  /**
   * 照目前效率:已投入 ÷ 完成比例.
   *
   * Assumes the rest of the work costs what the work so far cost, per unit of
   * progress. The pessimistic reading, and usually the right one — a project
   * that is 40% done having spent 60% of its money rarely recovers.
   */
  eacAtCurrentRate: number | null;
  /**
   * 剩餘照原預算:已投入 + 核准 × (1 − 完成比例).
   *
   * Assumes whatever has gone wrong so far will not go wrong again. Shown
   * beside the other one because the pair of them is the honest range.
   */
  eacRemainingAtPlan: number | null;
  /** 核准 − EAC(照目前效率)。負值 = 預計超支。 */
  varianceAtCompletion: number | null;
  /** True when the forecast cannot be computed at all — no progress recorded,
   *  or no budget approved. Saying so beats printing a confident zero. */
  noForecast: boolean;
};

function parseIso(value: string | null): number | null {
  if (!value) return null;
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : time;
}

function toIso(time: number): string {
  return new Date(time).toISOString().slice(0, 10);
}

/** How much of a straight-line plan should have been spent by `at`. */
function plannedFraction(at: number, start: number, end: number): number {
  if (at <= start) return 0;
  if (at >= end) return 1;
  const span = end - start;
  return span <= 0 ? 1 : (at - start) / span;
}

export function computeBudgetForecast(input: {
  budget: number;
  /** Booked spend, each with the day it happened. */
  expenses: DatedAmount[];
  /** Unsettled POs, each with its expected booking date. A null date means
   *  the money is committed but the timing is unknown. */
  commitments: DatedAmount[];
  /** The scope's schedule, for spreading the approved budget over time. */
  scheduleStart: string | null;
  scheduleEnd: string | null;
  /** 0–1, however the caller chose to weight it. */
  fractionDone: number | null;
  todayIso: string;
}): BudgetForecast {
  const { budget, expenses, commitments, fractionDone } = input;
  const today = parseIso(input.todayIso) ?? Date.now();
  const start = parseIso(input.scheduleStart);
  const end = parseIso(input.scheduleEnd);

  const spent = expenses.reduce((t, e) => t + e.amount, 0);
  const committedTotal = commitments.reduce((t, c) => t + c.amount, 0);
  const engaged = spent + committedTotal;

  const eacAtCurrentRate =
    fractionDone !== null && fractionDone > 0 ? engaged / fractionDone : null;
  const eacRemainingAtPlan =
    fractionDone !== null && budget > 0 ? engaged + budget * (1 - fractionDone) : null;

  // Undated commitments land at today: the money is already gone, only the
  // timing is unknown, and pushing them to the end of the chart would draw a
  // comfortable line that is not true.
  const datedCommitments = commitments.map((c) => ({
    at: parseIso(c.date) ?? today,
    amount: c.amount,
  }));
  const datedExpenses = expenses
    .map((e) => ({ at: parseIso(e.date), amount: e.amount }))
    .filter((e): e is { at: number; amount: number } => e.at !== null);

  const known = [
    ...datedExpenses.map((e) => e.at),
    ...datedCommitments.map((c) => c.at),
    ...(start !== null ? [start] : []),
    ...(end !== null ? [end] : []),
    today,
  ];
  const first = Math.min(...known);
  const last = Math.max(...known);

  const points: SpendPoint[] = [];
  // Weekly, for the same reason the progress curve is weekly: an NPI runs
  // over a year and a daily curve is noise.
  for (let cursor = first; ; cursor += WEEK_MS) {
    const at = Math.min(cursor, last);
    const actualAt = datedExpenses.filter((e) => e.at <= at).reduce((t, e) => t + e.amount, 0);
    // The committed line keeps going past today; the actual one stops.
    const spentByThen = datedExpenses
      .filter((e) => e.at <= Math.min(at, today))
      .reduce((t, e) => t + e.amount, 0);
    const committedByThen = datedCommitments
      .filter((c) => c.at <= at)
      .reduce((t, c) => t + c.amount, 0);

    points.push({
      iso: toIso(at),
      planned: start !== null && end !== null ? budget * plannedFraction(at, start, end) : null,
      actual: at <= today ? actualAt : null,
      committed: spentByThen + committedByThen,
    });
    if (at === last) break;
  }

  return {
    points,
    budget,
    engaged,
    fractionDone,
    eacAtCurrentRate,
    eacRemainingAtPlan,
    varianceAtCompletion: eacAtCurrentRate === null || budget === 0 ? null : budget - eacAtCurrentRate,
    noForecast: eacAtCurrentRate === null && eacRemainingAtPlan === null,
  };
}

/**
 * 完成比例, weighted by how long each task takes.
 *
 * Not a plain average: a phase with one 100-day task untouched and nineteen
 * one-day tasks finished is 5% done, not 95%, and an unweighted average would
 * forecast the budget off the wrong one.
 */
export function weightedFractionDone(
  tasks: { progressPct: number | null; days: number | null }[]
): number | null {
  const scored = tasks.filter((t) => t.progressPct !== null);
  if (scored.length === 0) return null;
  const totalWeight = scored.reduce((t, task) => t + Math.max(task.days ?? 1, 1), 0);
  if (totalWeight <= 0) return null;
  const done = scored.reduce(
    (t, task) => t + (task.progressPct! / 100) * Math.max(task.days ?? 1, 1),
    0
  );
  return Math.min(Math.max(done / totalWeight, 0), 1);
}
