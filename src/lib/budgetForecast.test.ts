import { describe, expect, it } from "vitest";
import { computeBudgetForecast, weightedFractionDone } from "./budgetForecast";

const base = {
  budget: 1_000_000,
  expenses: [],
  commitments: [],
  scheduleStart: "2026-01-01",
  scheduleEnd: "2026-12-31",
  fractionDone: null as number | null,
  todayIso: "2026-07-01",
};

describe("computeBudgetForecast", () => {
  it("forecasts the overrun before it happens", () => {
    // 40% 的工作做完,錢已經花掉 60 萬 —— 照這個效率跑完要 150 萬,核准只有
    // 100 萬。剩餘可用此刻還是正的 40 萬,但結局已經定了。
    const forecast = computeBudgetForecast({
      ...base,
      expenses: [{ date: "2026-06-01", amount: 600_000 }],
      fractionDone: 0.4,
    });

    expect(forecast.eacAtCurrentRate).toBe(1_500_000);
    expect(forecast.varianceAtCompletion).toBe(-500_000);
    expect(forecast.engaged).toBe(600_000);
  });

  it("counts committed money in the forecast, not just the spend", () => {
    // 只花了 20 萬,但已經簽了 40 萬的 PO。照 40% 進度推,結局是 150 萬。
    const forecast = computeBudgetForecast({
      ...base,
      expenses: [{ date: "2026-06-01", amount: 200_000 }],
      commitments: [{ date: "2026-08-01", amount: 400_000 }],
      fractionDone: 0.4,
    });

    expect(forecast.engaged).toBe(600_000);
    expect(forecast.eacAtCurrentRate).toBe(1_500_000);
  });

  it("gives the optimistic reading beside the pessimistic one", () => {
    const forecast = computeBudgetForecast({
      ...base,
      expenses: [{ date: "2026-06-01", amount: 600_000 }],
      fractionDone: 0.4,
    });

    // 剩下的 60% 照原預算走:60 萬 + 100 萬 × 0.6 = 120 萬。
    expect(forecast.eacRemainingAtPlan).toBe(1_200_000);
    // 兩個數字一起看才是誠實的區間。
    expect(forecast.eacAtCurrentRate).toBeGreaterThan(forecast.eacRemainingAtPlan!);
  });

  it("refuses to forecast when nothing says how far along the work is", () => {
    const forecast = computeBudgetForecast({
      ...base,
      expenses: [{ date: "2026-06-01", amount: 600_000 }],
      fractionDone: null,
    });

    expect(forecast.eacAtCurrentRate).toBeNull();
    expect(forecast.varianceAtCompletion).toBeNull();
    expect(forecast.noForecast).toBe(true);
  });

  it("stops the 實際 line at today but carries the 已承諾 line forward", () => {
    const forecast = computeBudgetForecast({
      ...base,
      expenses: [{ date: "2026-02-01", amount: 100_000 }],
      commitments: [{ date: "2026-10-01", amount: 300_000 }],
      fractionDone: 0.3,
    });

    const future = forecast.points.filter((p) => p.iso > base.todayIso);
    expect(future.length).toBeGreaterThan(0);
    expect(future.every((p) => p.actual === null)).toBe(true);
    // The PO lands in October, so by the end the committed line has it.
    expect(forecast.points[forecast.points.length - 1].committed).toBe(400_000);
  });

  it("spreads the approved budget across the schedule", () => {
    const forecast = computeBudgetForecast({ ...base, fractionDone: 0.5 });

    expect(forecast.points[0].planned).toBe(0);
    const last = forecast.points[forecast.points.length - 1];
    expect(last.planned).toBe(1_000_000);
    // Roughly halfway through the year, roughly half the budget.
    const mid = forecast.points.find((p) => p.iso >= "2026-07-01")!;
    expect(mid.planned).toBeGreaterThan(450_000);
    expect(mid.planned).toBeLessThan(550_000);
  });

  it("leaves the plan line out when the scope has no dates", () => {
    const forecast = computeBudgetForecast({
      ...base,
      scheduleStart: null,
      scheduleEnd: null,
      expenses: [{ date: "2026-06-01", amount: 100_000 }],
      fractionDone: 0.5,
    });

    expect(forecast.points.every((p) => p.planned === null)).toBe(true);
  });

  it("puts a PO with no expected date at today rather than out of sight", () => {
    const forecast = computeBudgetForecast({
      ...base,
      commitments: [{ date: null, amount: 250_000 }],
      fractionDone: 0.5,
    });

    const atToday = forecast.points.find((p) => p.iso >= base.todayIso)!;
    expect(atToday.committed).toBe(250_000);
  });
});

describe("weightedFractionDone", () => {
  it("weights by how long each task takes", () => {
    // 一個 100 天的沒動,十九個 1 天的做完了。
    const tasks = [
      { progressPct: 0, days: 100 },
      ...Array.from({ length: 19 }, () => ({ progressPct: 100, days: 1 })),
    ];

    const fraction = weightedFractionDone(tasks)!;
    // 不是 95% — 真正做完的只有 19/119。
    expect(Math.round(fraction * 100)).toBe(16);
  });

  it("says nothing when no task is scored", () => {
    expect(weightedFractionDone([{ progressPct: null, days: 5 }])).toBeNull();
  });

  it("treats a task with no duration as one day rather than weightless", () => {
    const fraction = weightedFractionDone([
      { progressPct: 100, days: null },
      { progressPct: 0, days: null },
    ]);

    expect(fraction).toBe(0.5);
  });

  it("never reports more than finished", () => {
    expect(weightedFractionDone([{ progressPct: 150, days: 1 }])).toBe(1);
  });
});
