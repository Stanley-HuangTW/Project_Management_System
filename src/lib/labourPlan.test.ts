import { describe, expect, it } from "vitest";
import {
  effectiveHourlyRate,
  hourlyRateSource,
  personMonthCost,
  personMonthsToHours,
  summariseLabourPlan,
} from "./labourPlan";

const factors = { workingDaysPerMonth: 21, hoursPerDay: 8 };
// 21 × 8 = 168 小時/月
const rates = { EE: 168_000, ME: 84_000, PM: 168_000 } as const;

describe("effectiveHourlyRate", () => {
  it("個人時薪最優先 —— 現有的成本數字不會因為多了月薪這條路而改變", () => {
    const rate = effectiveHourlyRate(
      { hourlyRate: 1500, monthlySalary: 168_000, discipline: "EE" },
      rates,
      factors
    );
    expect(rate).toBe(1500);
  });

  it("沒有時薪就用個人月薪換算", () => {
    expect(
      effectiveHourlyRate({ hourlyRate: null, monthlySalary: 168_000, discipline: "ME" }, rates, factors)
    ).toBe(1000);
  });

  it("都沒有就用所屬單位的標準月薪", () => {
    expect(
      effectiveHourlyRate({ hourlyRate: null, monthlySalary: null, discipline: "ME" }, rates, factors)
    ).toBe(500);
  });

  it("三條都沒有就是 0,不憑空生出成本", () => {
    expect(effectiveHourlyRate({ discipline: "SW" }, rates, factors)).toBe(0);
    expect(effectiveHourlyRate({}, rates, factors)).toBe(0);
  });

  it("換算係數是 0 的時候不會除以零", () => {
    expect(
      effectiveHourlyRate({ monthlySalary: 168_000 }, rates, { workingDaysPerMonth: 0, hoursPerDay: 8 })
    ).toBe(0);
  });
});

describe("hourlyRateSource", () => {
  it("說得出這個數字是哪裡來的", () => {
    expect(hourlyRateSource({ hourlyRate: 1500 }, rates)).toBe("hourly");
    expect(hourlyRateSource({ monthlySalary: 90_000 }, rates)).toBe("salary");
    expect(hourlyRateSource({ discipline: "EE" }, rates)).toBe("discipline");
    expect(hourlyRateSource({ discipline: "SW" }, rates)).toBe("none");
  });
});

describe("personMonthCost", () => {
  it("人月 × 單位標準月薪", () => {
    expect(personMonthCost(3, "EE", rates)).toBe(504_000);
    expect(personMonthCost(0.5, "ME", rates)).toBe(42_000);
  });

  it("單位沒有標準價就是 0,不用別的單位的價錢去猜", () => {
    expect(personMonthCost(3, "SW", rates)).toBe(0);
  });
});

describe("summariseLabourPlan", () => {
  const phases = [
    { id: "poc", name: "POC Phase" },
    { id: "evt", name: "EVT Phase" },
  ];
  const cells = [
    { itemId: "poc", discipline: "EE" as const, personMonths: 3 },
    { itemId: "poc", discipline: "ME" as const, personMonths: 2 },
    { itemId: "evt", discipline: "EE" as const, personMonths: 1 },
    { itemId: "evt", discipline: "PM" as const, personMonths: 0.5 },
  ];

  it("每個階段一列,每個單位一格,順序固定", () => {
    const summary = summariseLabourPlan(phases, cells, rates);
    expect(summary.rows.map((r) => r.itemName)).toEqual(["POC Phase", "EVT Phase"]);
    expect(summary.rows[0].cells.map((c) => c.discipline)).toEqual(["EE", "SW", "QA", "ME", "PM", "OTHER"]);
  });

  it("階段小計 = 那一列的人月與金額", () => {
    const [poc] = summariseLabourPlan(phases, cells, rates).rows;
    expect(poc.personMonths).toBe(5);
    expect(poc.amount).toBe(3 * 168_000 + 2 * 84_000);
  });

  it("單位小計是跨階段加總", () => {
    const summary = summariseLabourPlan(phases, cells, rates);
    const ee = summary.byDiscipline.find((d) => d.discipline === "EE")!;
    expect(ee.personMonths).toBe(4);
    expect(ee.amount).toBe(4 * 168_000);
  });

  it("總計對得起來", () => {
    const summary = summariseLabourPlan(phases, cells, rates);
    expect(summary.totalPersonMonths).toBe(6.5);
    expect(summary.totalAmount).toBe(summary.rows.reduce((t, r) => t + r.amount, 0));
  });

  it("有填人月但單位沒有標準價的,點名出來 —— 那些人月算不出錢", () => {
    const summary = summariseLabourPlan(
      phases,
      [...cells, { itemId: "poc", discipline: "SW" as const, personMonths: 4 }],
      rates
    );
    expect(summary.unpricedDisciplines).toEqual(["SW"]);
    // 算不出錢的人月仍然算進人月合計,只是金額是 0。
    expect(summary.totalPersonMonths).toBe(10.5);
  });

  it("沒有任何格子的時候全部是 0", () => {
    const summary = summariseLabourPlan(phases, [], rates);
    expect(summary.totalAmount).toBe(0);
    expect(summary.totalPersonMonths).toBe(0);
    expect(summary.unpricedDisciplines).toEqual([]);
  });
});

describe("personMonthsToHours", () => {
  it("一個人月 = 每月工作天 × 每日工時", () => {
    expect(personMonthsToHours(1, factors)).toBe(168);
    expect(personMonthsToHours(2.5, factors)).toBe(420);
  });
});
