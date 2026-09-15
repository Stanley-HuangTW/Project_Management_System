/**
 * The already-resolved figures the 預算 / 燃盡圖 / 延遲追因 sheets render.
 *
 * Plain numbers and finished labels, deliberately: the workbook builder should
 * lay out a sheet, not re-derive a budget. Everything here is produced by the
 * same functions the on-screen pages use (getBudgetView, analyzeDelays), so an
 * exported figure and the one in the app cannot drift apart.
 */

export type BudgetLineExport = {
  /** 類別, already in Chinese — 人力/材料/… or 合計. */
  label: string;
  budget: number;
  actual: number;
  committed: number;
  remaining: number;
  /** Null when nothing was approved — a percentage of zero says nothing. */
  usedPct: number | null;
};

export type ReserveLineExport = {
  label: string;
  approved: number;
  drawn: number;
  remaining: number;
};

/** One week of the burn-down. Mirrors SpendPoint, with the nulls kept: a
 *  missing planned line means the scope has no dates to spread the budget
 *  across, and a missing actual means the week has not happened yet. */
export type SpendPointExport = {
  iso: string;
  planned: number | null;
  actual: number | null;
  committed: number;
};

export type BudgetScopeExport = {
  name: string;
  /** 階段 or 專案群組 — the two levels a budget is approved at. */
  kind: string;
  /** 未超支 / 接近上限 / 需動用準備金 / 已超支. */
  alert: string;
  lines: BudgetLineExport[];
  total: BudgetLineExport;
  reserves: ReserveLineExport[];
  /** 人力實際成本, derived from approved timesheets rather than booked. */
  labourActual: number;
  /** 0-1, weighted by task length. Null when nothing records progress. */
  fractionDone: number | null;
  /** 已花費 + 已承諾. */
  engaged: number;
  eacAtCurrentRate: number | null;
  eacRemainingAtPlan: number | null;
  varianceAtCompletion: number | null;
  points: SpendPointExport[];
};

export type DelayCulpritExport = {
  wbsCode: string;
  name: string;
  startDelta: number;
  endDelta: number;
  daysDelta: number;
  inheritedDelay: number;
  ownDelay: number;
  downstreamCount: number;
};

export type DelayExport = {
  /** The worst finish slip anywhere in scope, in calendar days. */
  projectDelay: number;
  /** True when nothing carries a baseline — there is nothing to compare. */
  noBaseline: boolean;
  culprits: DelayCulpritExport[];
};
