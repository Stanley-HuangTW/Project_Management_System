import { computeEvm, makeCost, type CostBreakdown, type EvmResult } from "@/lib/cost";

/** One leaf task's money, already resolved to numbers. */
export type CostItemInput = {
  id: string;
  name: string;
  /** 計畫:配置換算的工時 × 費率。 */
  plannedLabour: number;
  /** 計畫:填在項目上的直接費用預算。 */
  plannedDirect: number;
  /** 實際:登記的工時 × 費率。 */
  actualLabour: number;
  /** 實際:填在項目上的直接費用。 */
  actualDirect: number;
  /** 0-1. Where the progress column is empty this is 1 for a completed task
   *  and 0 otherwise — a task nobody has scored is not half done. */
  fractionDone: number;
  /** The plan's dates — the baseline where there is one, today's schedule
   *  otherwise. PV is read off these, so a board with no baseline measures
   *  itself against the plan it currently holds. */
  plannedStart: Date | null;
  plannedEnd: Date | null;
};

export type CostRow = CostItemInput & {
  budget: number;
  actual: number;
  /** 實獲值:預算 × 完成比例。 */
  earned: number;
  /** Actual minus earned: positive means this task cost more than the work
   *  done on it was worth. */
  overrun: number;
};

export type BoardCostSummary = {
  planned: CostBreakdown;
  actual: CostBreakdown;
  evm: EvmResult;
  rows: CostRow[];
};

/**
 * How much of a task the plan says should be done by `today`.
 *
 * Straight-line across its planned span, which is the standard assumption
 * and the only one available without a spend curve per task: nothing before
 * it starts, all of it once its planned finish has passed.
 */
export function plannedFraction(item: CostItemInput, today: Date): number {
  const { plannedStart, plannedEnd } = item;
  if (!plannedStart || !plannedEnd) return 0;
  if (today < plannedStart) return 0;
  if (today >= plannedEnd) return 1;
  const span = plannedEnd.getTime() - plannedStart.getTime();
  if (span <= 0) return 1;
  return (today.getTime() - plannedStart.getTime()) / span;
}

/**
 * 成本與 EVM for a whole board.
 *
 * PV, EV and AC are all in the same currency and all built from the same
 * per-task budget, so the three curves are comparable — which is the entire
 * point of the technique and the thing that goes wrong when the actuals are
 * kept somewhere else.
 */
export function computeBoardCost(items: CostItemInput[], today: Date): BoardCostSummary {
  const rows: CostRow[] = items.map((item) => {
    const budget = item.plannedLabour + item.plannedDirect;
    const actual = item.actualLabour + item.actualDirect;
    const earned = budget * item.fractionDone;
    return { ...item, budget, actual, earned, overrun: actual - earned };
  });

  const planned = makeCost(
    items.reduce((sum, i) => sum + i.plannedLabour, 0),
    items.reduce((sum, i) => sum + i.plannedDirect, 0)
  );
  const actual = makeCost(
    items.reduce((sum, i) => sum + i.actualLabour, 0),
    items.reduce((sum, i) => sum + i.actualDirect, 0)
  );

  const bac = planned.total;
  const pv = rows.reduce((sum, row) => sum + row.budget * plannedFraction(row, today), 0);
  const ev = rows.reduce((sum, row) => sum + row.earned, 0);

  return { planned, actual, evm: computeEvm({ bac, pv, ev, ac: actual.total }), rows };
}
