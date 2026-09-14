import { describe, expect, it } from "vitest";
import { summarizeBudget, alertLevel, summarizeReserves } from "./budget";

const b = (category: Parameters<typeof summarizeBudget>[0]["budgets"][number]["category"], amount: number) => ({
  category,
  amount,
});

describe("summarizeBudget", () => {
  it("subtracts both spent and committed from what was approved", () => {
    // 材料 核准 100 萬,花掉 30 萬,另外簽了 50 萬的 PO 還沒入帳。
    const summary = summarizeBudget({
      budgets: [b("MATERIAL", 1_000_000)],
      actuals: [b("MATERIAL", 300_000)],
      commitments: [b("MATERIAL", 500_000)],
    });

    const material = summary.lines.find((l) => l.category === "MATERIAL")!;
    expect(material.remaining).toBe(200_000);
    expect(material.usedPct).toBe(80);
    expect(material.isOver).toBe(false);
  });

  it("counts a signed PO as gone — this is the whole point of committed", () => {
    // 只看實際支出的話還剩 70 萬,看起來很寬裕;算進 PO 其實已經超支。
    const summary = summarizeBudget({
      budgets: [b("MATERIAL", 1_000_000)],
      actuals: [b("MATERIAL", 300_000)],
      commitments: [b("MATERIAL", 900_000)],
    });

    expect(summary.isOver).toBe(true);
    expect(summary.total.remaining).toBe(-200_000);
  });

  it("treats spend in a category nobody budgeted as over, not as free", () => {
    const summary = summarizeBudget({
      budgets: [b("MATERIAL", 1_000_000)],
      actuals: [b("TRAVEL", 50_000)],
      commitments: [],
    });

    const travel = summary.lines.find((l) => l.category === "TRAVEL")!;
    expect(travel.isOver).toBe(true);
    // Named, so the fix is obvious: go and approve a travel budget.
    expect(summary.unbudgetedCategories).toEqual(["TRAVEL"]);
    // The project as a whole is still inside its total, and says so.
    expect(summary.isOver).toBe(false);
  });

  it("leaves a category with no budget and no spend out of the table", () => {
    const summary = summarizeBudget({
      budgets: [b("MATERIAL", 1_000_000)],
      actuals: [],
      commitments: [],
    });

    expect(summary.lines.map((l) => l.category)).toEqual(["MATERIAL"]);
  });

  it("counts labour alongside everything else", () => {
    const summary = summarizeBudget({
      budgets: [b("LABOUR", 500_000), b("MATERIAL", 500_000)],
      actuals: [b("LABOUR", 600_000)],
      commitments: [],
    });

    const labour = summary.lines.find((l) => l.category === "LABOUR")!;
    expect(labour.remaining).toBe(-100_000);
    expect(labour.isOver).toBe(true);
    // 人力爆了,但整體還在核准總額之內。
    expect(summary.total.remaining).toBe(400_000);
    expect(summary.isOver).toBe(false);
  });

  it("says it has nothing to measure against rather than showing 0%", () => {
    const summary = summarizeBudget({ budgets: [], actuals: [], commitments: [] });

    expect(summary.noBudget).toBe(true);
    expect(summary.total.usedPct).toBeNull();
    expect(summary.isOver).toBe(false);
  });

  it("flags spend with no budget anywhere as over", () => {
    const summary = summarizeBudget({
      budgets: [],
      actuals: [b("MATERIAL", 10_000)],
      commitments: [],
    });

    expect(summary.noBudget).toBe(true);
    expect(summary.isOver).toBe(true);
  });
});

describe("alertLevel", () => {
  const at = (budget: number, actual: number, committed = 0) =>
    alertLevel(
      summarizeBudget({
        budgets: budget ? [b("MATERIAL", budget)] : [],
        actuals: [b("MATERIAL", actual)],
        commitments: committed ? [b("MATERIAL", committed)] : [],
      })
    );

  it("stays quiet below the threshold", () => {
    expect(at(1_000_000, 700_000)).toBe("none");
  });

  it("warns at 80% of the approved amount", () => {
    expect(at(1_000_000, 800_000)).toBe("warning");
  });

  it("counts commitments toward the warning", () => {
    // 花了 50 萬,另外簽了 35 萬的 PO — 85%,該提醒了。
    expect(at(1_000_000, 500_000, 350_000)).toBe("warning");
  });

  it("escalates once it is actually over", () => {
    expect(at(1_000_000, 1_100_000)).toBe("over");
  });

  it("says nothing when no budget was ever approved", () => {
    expect(at(0, 0)).toBe("none");
  });
});

describe("summarizeReserves", () => {
  const r = (kind: "CONTINGENCY" | "MANAGEMENT", amount: number) => ({ kind, amount });

  it("keeps the approved amount intact and takes the draws off the balance", () => {
    const state = summarizeReserves(
      [r("CONTINGENCY", 500_000), r("MANAGEMENT", 300_000)],
      [r("CONTINGENCY", 120_000)]
    );

    // 原始額度不動 —— 下一個專案要編列緩衝時,唯一的依據就是這個對照。
    expect(state.contingency.approved).toBe(500_000);
    expect(state.contingency.drawn).toBe(120_000);
    expect(state.contingency.remaining).toBe(380_000);
    expect(state.management.remaining).toBe(300_000);
    expect(state.totalRemaining).toBe(680_000);
  });

  it("reports zeros rather than nothing when no reserve was approved", () => {
    const state = summarizeReserves([], []);
    expect(state.totalRemaining).toBe(0);
    expect(state.totalApproved).toBe(0);
  });
});

describe("alertLevel with a reserve", () => {
  const over = (by: number) =>
    summarizeBudget({
      budgets: [b("MATERIAL", 1_000_000)],
      actuals: [b("MATERIAL", 1_000_000 + by)],
      commitments: [],
    });

  it("says 動用準備金 rather than 超支 while the cushion covers it", () => {
    // 超出成本基準 20 萬,但還有 50 萬應變準備金。
    expect(alertLevel(over(200_000), 80, 500_000)).toBe("reserve");
  });

  it("escalates to 超支 once the cushion runs out too", () => {
    expect(alertLevel(over(600_000), 80, 500_000)).toBe("over");
  });

  it("treats an exactly-covered overrun as still inside the reserve", () => {
    expect(alertLevel(over(500_000), 80, 500_000)).toBe("reserve");
  });

  it("behaves as before when there is no reserve", () => {
    expect(alertLevel(over(1), 80, 0)).toBe("over");
  });
});
