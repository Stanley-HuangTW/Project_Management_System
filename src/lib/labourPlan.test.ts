import { describe, expect, it } from "vitest";
import {
  applySheetAmounts,
  effectiveHourlyRate,
  hourlyRateSource,
  personMonthCost,
  personMonthsToHours,
  summariseLabourPlan,
} from "./labourPlan";

const factors = { workingDaysPerMonth: 21, hoursPerDay: 8 };
// 21 × 8 = 168 小時/月
const rates = { EE: 168_000, ME: 84_000, PM: 168_000 } as const;

// 單位清單現在是系統設定,不是寫死的列舉 —— 測試自己給一份,順序就是表格
// 欄位的順序。
const UNITS = [
  { code: "EE", label: "EE 電機", order: 0 },
  { code: "SW", label: "SW 軟體", order: 1 },
  { code: "QA", label: "QA 品保", order: 2 },
  { code: "ME", label: "ME 機構", order: 3 },
  { code: "PM", label: "PM 專案", order: 4 },
  { code: "OTHER", label: "其他", order: 5 },
];

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
    { rowId: "poc", discipline: "EE" as const, personMonths: 3 },
    { rowId: "poc", discipline: "ME" as const, personMonths: 2 },
    { rowId: "evt", discipline: "EE" as const, personMonths: 1 },
    { rowId: "evt", discipline: "PM" as const, personMonths: 0.5 },
  ];

  it("每個階段一列,每個單位一格,順序固定", () => {
    const summary = summariseLabourPlan(phases, cells, rates, UNITS);
    expect(summary.rows.map((r) => r.itemName)).toEqual(["POC Phase", "EVT Phase"]);
    expect(summary.rows[0].cells.map((c) => c.discipline)).toEqual(["EE", "SW", "QA", "ME", "PM", "OTHER"]);
  });

  it("階段小計 = 那一列的人月與金額", () => {
    const [poc] = summariseLabourPlan(phases, cells, rates, UNITS).rows;
    expect(poc.personMonths).toBe(5);
    expect(poc.amount).toBe(3 * 168_000 + 2 * 84_000);
  });

  it("單位小計是跨階段加總", () => {
    const summary = summariseLabourPlan(phases, cells, rates, UNITS);
    const ee = summary.byDiscipline.find((d) => d.discipline === "EE")!;
    expect(ee.personMonths).toBe(4);
    expect(ee.amount).toBe(4 * 168_000);
  });

  it("總計對得起來", () => {
    const summary = summariseLabourPlan(phases, cells, rates, UNITS);
    expect(summary.totalPersonMonths).toBe(6.5);
    expect(summary.totalAmount).toBe(summary.rows.reduce((t, r) => t + r.amount, 0));
  });

  it("有填人月但單位沒有標準價的,點名出來 —— 那些人月算不出錢", () => {
    const summary = summariseLabourPlan(
      phases,
      [...cells, { rowId: "poc", discipline: "SW" as const, personMonths: 4 }],
      rates,
      UNITS
    );
    expect(summary.unpricedDisciplines).toEqual(["SW"]);
    // 算不出錢的人月仍然算進人月合計,只是金額是 0。
    expect(summary.totalPersonMonths).toBe(10.5);
  });

  it("沒有任何格子的時候全部是 0", () => {
    const summary = summariseLabourPlan(phases, [], rates, UNITS);
    expect(summary.totalAmount).toBe(0);
    expect(summary.totalPersonMonths).toBe(0);
    expect(summary.unpricedDisciplines).toEqual([]);
  });

  it("加總不會冒出二進位小數誤差(例如 44.999999999999999)", () => {
    // 8 + 9.4 + 20.4 + 4.8 + 2.4 在浮點數裡加總會得到
    // 44.99999999999999,不是乾淨的 45。
    const driftPhases = [{ id: "dvt1", name: "DVT1" }];
    const driftCells = [
      { rowId: "dvt1", discipline: "EE" as const, personMonths: 8 },
      { rowId: "dvt1", discipline: "SW" as const, personMonths: 9.4 },
      { rowId: "dvt1", discipline: "ME" as const, personMonths: 20.4 },
      { rowId: "dvt1", discipline: "QA" as const, personMonths: 4.8 },
      { rowId: "dvt1", discipline: "PM" as const, personMonths: 2.4 },
    ];
    const summary = summariseLabourPlan(driftPhases, driftCells, rates, UNITS);
    expect(summary.rows[0].personMonths).toBe(45);
    expect(summary.totalPersonMonths).toBe(45);
  });
});

describe("personMonthsToHours", () => {
  it("一個人月 = 每月工作天 × 每日工時", () => {
    expect(personMonthsToHours(1, factors)).toBe(168);
    expect(personMonthsToHours(2.5, factors)).toBe(420);
  });
});

describe("applySheetAmounts(人力表有名額用個人月薪算)", () => {
  const phases = [{ id: "p1", name: "EFS" }, { id: "p2", name: "EVT" }];
  const cells = [
    { rowId: "p1", discipline: "EE", personMonths: 3 },
    { rowId: "p2", discipline: "EE", personMonths: 2 },
    { rowId: "p2", discipline: "ME", personMonths: 1 },
  ];
  const base = summariseLabourPlan(phases, cells, rates, UNITS);
  const sheet = {
    byPhase: [
      { phaseId: "p1", byDiscipline: [{ discipline: "EE", amount: 450_000 }, { discipline: "ME", amount: 0 }] },
      { phaseId: "p2", byDiscipline: [{ discipline: "EE", amount: 300_000 }, { discipline: "ME", amount: 84_000 }] },
    ],
    unpricedDisciplines: [],
  };

  it("人月不變,格子的金額、階段合計、單位合計、總計都以人力表為準", () => {
    // 單位標準月薪的算法:EE 5 × 168,000 = 840,000;ME 1 × 84,000。
    expect(base.totalAmount).toBe(5 * 168_000 + 84_000);
    const out = applySheetAmounts(base, sheet);
    expect(out.rows[0].cells.find((c) => c.discipline === "EE")).toMatchObject({ personMonths: 3, amount: 450_000 });
    expect(out.rows[0].amount).toBe(450_000);
    expect(out.rows[1].amount).toBe(384_000);
    expect(out.byDiscipline.find((d) => d.discipline === "EE")).toMatchObject({ personMonths: 5, amount: 750_000 });
    expect(out.totalAmount).toBe(834_000);
    expect(out.totalPersonMonths).toBe(base.totalPersonMonths);
  });

  it("算不出錢的單位以人力表的判斷為準", () => {
    expect(applySheetAmounts(base, { ...sheet, unpricedDisciplines: ["OTHER"] }).unpricedDisciplines).toEqual(["OTHER"]);
  });

  it("人力表裡沒有的格子維持原本的金額", () => {
    const out = applySheetAmounts(base, { byPhase: [], unpricedDisciplines: [] });
    expect(out.totalAmount).toBe(base.totalAmount);
  });
});
