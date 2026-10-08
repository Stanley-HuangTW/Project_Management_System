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
  "CERTIFICATION",
  "OUTSOURCING",
  "TRAVEL",
  "OTHER",
];

export const CATEGORY_LABELS: Record<CostCategory, string> = {
  LABOUR: "人力",
  // 跟 NRE 的四大項對得上:人力 = 研發人力、材料 = 打樣與樣品、模具與治具、驗證與認證。
  MATERIAL: "材料(打樣與樣品)",
  TOOLING: "模具與治具",
  CERTIFICATION: "驗證與認證",
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

/**
 * 準備金的狀態。
 *
 * 核准額度不會因為動支而變小——餘額是它減掉已動支的。原始額度留著,才看得出
 * 「當初編了多少緩衝、用掉了多少」,那是下一個專案編列時唯一的依據。
 */
export type ReserveLine = {
  /** 核准的原始額度。 */
  approved: number;
  /** 已經撥進各類別的。 */
  drawn: number;
  remaining: number;
};

export type ReserveState = {
  contingency: ReserveLine;
  management: ReserveLine;
  /** 兩種加起來還剩多少 —— 成本基準之外還有多少緩衝。 */
  totalRemaining: number;
  totalApproved: number;
};

export function summarizeReserves(
  reserves: { kind: "CONTINGENCY" | "MANAGEMENT"; amount: number }[],
  draws: { kind: "CONTINGENCY" | "MANAGEMENT"; amount: number }[]
): ReserveState {
  const line = (kind: "CONTINGENCY" | "MANAGEMENT"): ReserveLine => {
    const approved = reserves.filter((r) => r.kind === kind).reduce((t, r) => t + r.amount, 0);
    const drawn = draws.filter((d) => d.kind === kind).reduce((t, d) => t + d.amount, 0);
    return { approved, drawn, remaining: approved - drawn };
  };
  const contingency = line("CONTINGENCY");
  const management = line("MANAGEMENT");
  return {
    contingency,
    management,
    totalRemaining: contingency.remaining + management.remaining,
    totalApproved: contingency.approved + management.approved,
  };
}

/**
 * 預算用掉多少就該示警。
 *
 * "reserve" sits between warning and over on purpose: a phase past its cost
 * baseline but still inside its contingency is not the same emergency as one
 * with nothing left, and colouring them the same teaches people to ignore the
 * colour.
 */
export type BudgetAlertLevel = "none" | "warning" | "reserve" | "over";

export function alertLevel(
  summary: BudgetSummary,
  warnAtPct = 80,
  reserveRemaining = 0
): BudgetAlertLevel {
  if (summary.noBudget && reserveRemaining === 0) return "none";
  if (summary.isOver) {
    // Over the baseline, but the cushion still covers it.
    return Math.abs(summary.total.remaining) <= reserveRemaining ? "reserve" : "over";
  }
  const used = summary.total.usedPct;
  return used !== null && used >= warnAtPct ? "warning" : "none";
}
