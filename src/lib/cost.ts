/**
 * 成本與 EVM.
 *
 * Two kinds of money, kept apart all the way through: 人力成本, which is
 * hours × a rate, and 直接費用 (NRE, BOM, 外包), which is an amount somebody
 * agreed to pay. Adding them up early would leave you knowing you are over
 * budget without knowing whether it was the parts or the people.
 */

export type CostBreakdown = {
  /** 人力:計畫配置換算的工時 × 費率。 */
  labour: number;
  /** 直接費用:NRE/BOM 等填進去的金額。 */
  direct: number;
  total: number;
};

export function addCost(a: CostBreakdown, b: CostBreakdown): CostBreakdown {
  return { labour: a.labour + b.labour, direct: a.direct + b.direct, total: a.total + b.total };
}

export const ZERO_COST: CostBreakdown = { labour: 0, direct: 0, total: 0 };

export function makeCost(labour: number, direct: number): CostBreakdown {
  return { labour, direct, total: labour + direct };
}

/**
 * Turns an allocation into money.
 *
 * `allocationPct` is what the plan says: 50% of someone's day for the days
 * the task runs. hoursPerDay is the company's own working day — the factor
 * that makes "50% for 10 days" a number of hours at all.
 */
export function labourCost(
  workingDays: number,
  allocationPct: number,
  hourlyRate: number,
  hoursPerDay: number
): number {
  if (workingDays <= 0 || allocationPct <= 0 || hourlyRate <= 0 || hoursPerDay <= 0) return 0;
  return workingDays * hoursPerDay * (allocationPct / 100) * hourlyRate;
}

export type EvmInput = {
  /** 完工總預算 — every task's planned cost, whether or not it has started. */
  bac: number;
  /** 計畫價值:到今天為止「照計畫應該已經做完」的那部分預算。 */
  pv: number;
  /** 實獲值:實際完成比例 × 預算。 */
  ev: number;
  /** 實際成本:已經花掉的。 */
  ac: number;
};

export type EvmResult = EvmInput & {
  /** EV − AC. Negative means the work done cost more than it was budgeted. */
  costVariance: number;
  /** EV − PV. Negative means less work is done than the plan called for. */
  scheduleVariance: number;
  /** EV / AC. Null when nothing has been spent — a ratio over zero says
   *  nothing, and showing "∞ 效率" would be worse than showing nothing. */
  cpi: number | null;
  /** EV / PV. Null before the plan says anything should have been done. */
  spi: number | null;
  /** 完工預估:照目前的成本效率跑完,總共會花多少。 */
  eac: number | null;
};

export function computeEvm(input: EvmInput): EvmResult {
  const { bac, pv, ev, ac } = input;
  const cpi = ac > 0 ? ev / ac : null;
  return {
    ...input,
    costVariance: ev - ac,
    scheduleVariance: ev - pv,
    cpi,
    spi: pv > 0 ? ev / pv : null,
    // The textbook EAC: what is left costs what the work so far has cost,
    // per unit of value. Meaningless before anything has been spent.
    eac: cpi && cpi > 0 ? bac / cpi : null,
  };
}

/** "1.05" / "0.87" — two decimals, and a dash when the index cannot be
 *  computed yet, so a table never shows a confident-looking zero. */
export function formatIndex(value: number | null): string {
  return value === null ? "—" : value.toFixed(2);
}

/** Money as people here write it: no decimals, thousands separated. */
export function formatMoney(value: number): string {
  return Math.round(value).toLocaleString("zh-TW");
}
