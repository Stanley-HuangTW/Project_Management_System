import type { CostCategory } from "@prisma/client";

/**
 * 預算管控 — 核准了多少、花掉多少、承諾出去多少、還剩多少。
 *
 * Deliberately a different question from the EVM report next to it. EVM asks
 * whether the work done cost more than it was estimated to (CPI); this asks
 * whether the project is going to run out of money. A project can be running
 * at CPI 1.0 — every task exactly on its estimate — and still blow its funding,
 * because the estimates added up to more than was ever approved.
 */

export const COST_CATEGORIES: CostCategory[] = [
  "LABOUR",
  "MATERIAL",
  "TOOLING",
  "OUTSOURCING",
  "TRAVEL",
  "OTHER",
];

export const CATEGORY_LABELS: Record<CostCategory, string> = {
  LABOUR: "人力",
  MATERIAL: "材料",
  TOOLING: "模具",
  OUTSOURCING: "委外",
  TRAVEL: "差旅",
  OTHER: "其他",
};

export type CategoryLine = {
  category: CostCategory;
  /** 核准預算。0 means nothing was approved for this category. */
  budget: number;
  /** 實際支出:已經付掉或已入帳的。 */
  actual: number;
  /** 已下單未入帳:PO 簽了、發票還沒來。 */
  committed: number;
  /** budget − actual − committed. Negative means the money is already spoken
   *  for beyond what was approved. */
  remaining: number;
  /** (actual + committed) / budget, as a percentage. Null when nothing was
   *  approved — a percentage of zero says nothing. */
  usedPct: number | null;
  /** True once the approved amount is exhausted. A category with no budget
   *  but real spend is over too: nobody approved that money. */
  isOver: boolean;
};

export type BudgetSummary = {
  lines: CategoryLine[];
  total: CategoryLine;
  /** Categories carrying spend or commitments that nobody budgeted for.
   *  Reported by name because the fix is to go and approve a budget for
   *  them, not to stare at a total that quietly includes them. */
  unbudgetedCategories: CostCategory[];
  /** True when the whole thing is past its approved total. */
  isOver: boolean;
  /** True when nothing has been approved at all — the summary then has
   *  nothing to measure against and should say so rather than show 0%. */
  noBudget: boolean;
};

function line(
  category: CostCategory,
  budget: number,
  actual: number,
  committed: number
): CategoryLine {
  const remaining = budget - actual - committed;
  return {
    category,
    budget,
    actual,
    committed,
    remaining,
    usedPct: budget > 0 ? ((actual + committed) / budget) * 100 : null,
    // Spending against a category nobody approved counts as over: the
    // alternative is a line that reads 0 budget, real money, and no warning.
    isOver: budget > 0 ? remaining < 0 : actual + committed > 0,
  };
}

/**
 * Rolls the three ledgers up into one answer per category, plus a total.
 *
 * 人力 is included like any other category, but its actual comes from approved
 * timesheets rather than from an expense somebody typed — booking it by hand
 * as well would count the same hours twice.
 */
export function summarizeBudget(input: {
  budgets: { category: CostCategory; amount: number }[];
  actuals: { category: CostCategory; amount: number }[];
  commitments: { category: CostCategory; amount: number }[];
}): BudgetSummary {
  const sum = (
    rows: { category: CostCategory; amount: number }[],
    category: CostCategory
  ) => rows.filter((r) => r.category === category).reduce((t, r) => t + r.amount, 0);

  const lines = COST_CATEGORIES.map((category) =>
    line(
      category,
      sum(input.budgets, category),
      sum(input.actuals, category),
      sum(input.commitments, category)
    )
  );

  const totalBudget = lines.reduce((t, l) => t + l.budget, 0);
  const totalActual = lines.reduce((t, l) => t + l.actual, 0);
  const totalCommitted = lines.reduce((t, l) => t + l.committed, 0);
  const total = line("OTHER", totalBudget, totalActual, totalCommitted);

  return {
    // Only the categories in play — a table of six rows where four are all
    // zeros hides the two that matter.
    lines: lines.filter((l) => l.budget > 0 || l.actual > 0 || l.committed > 0),
    total: { ...total, category: "OTHER" },
    unbudgetedCategories: lines
      .filter((l) => l.budget === 0 && l.actual + l.committed > 0)
      .map((l) => l.category),
    isOver: totalBudget > 0 ? total.remaining < 0 : totalActual + totalCommitted > 0,
    noBudget: totalBudget === 0,
  };
}

/** 預算用掉多少就該示警。80% 是提醒,100% 是已經超了。 */
export type BudgetAlertLevel = "none" | "warning" | "over";

export function alertLevel(summary: BudgetSummary, warnAtPct = 80): BudgetAlertLevel {
  if (summary.noBudget) return "none";
  if (summary.isOver) return "over";
  const used = summary.total.usedPct;
  return used !== null && used >= warnAtPct ? "warning" : "none";
}
