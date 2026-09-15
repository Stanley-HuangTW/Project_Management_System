import { describe, expect, it } from "vitest";
import {
  buildLabourSheet,
  monthAxis,
  monthKeyOf,
  phaseOfMonth,
  phaseVariances,
  type PhaseRow,
  type SlotRow,
} from "./labourSheet";

const rates = { EE: 168_000, ME: 105_000, PM: 126_000 } as const;

const phases: PhaseRow[] = [
  { id: "efs", name: "EFS", startDate: "2026-03-02", endDate: "2026-05-31", itemId: "i-efs" },
  { id: "evt", name: "EVT", startDate: "2026-06-01", endDate: "2026-08-31", itemId: "i-evt" },
];

const slot = (
  id: string,
  discipline: SlotRow["discipline"],
  months: Record<string, number>
): SlotRow => ({
  id,
  discipline,
  label: id,
  func: "",
  ownerName: "TBH",
  description: "",
  months,
});

describe("monthAxis", () => {
  it("從最早的開始月排到最晚的結束月", () => {
    expect(monthAxis(phases)).toEqual([
      "2026-03",
      "2026-04",
      "2026-05",
      "2026-06",
      "2026-07",
      "2026-08",
    ]);
  });

  it("跨年不會斷", () => {
    expect(
      monthAxis([{ startDate: "2026-11-01", endDate: "2027-02-15" }])
    ).toEqual(["2026-11", "2026-12", "2027-01", "2027-02"]);
  });

  it("中間的空檔仍然留欄位 —— 不然三月接六月會看起來像連續的", () => {
    const axis = monthAxis([
      { startDate: "2026-03-01", endDate: "2026-03-31" },
      { startDate: "2026-06-01", endDate: "2026-06-30" },
    ]);
    expect(axis).toEqual(["2026-03", "2026-04", "2026-05", "2026-06"]);
  });

  it("沒有階段就沒有月份欄位", () => {
    expect(monthAxis([])).toEqual([]);
  });
});

describe("phaseOfMonth", () => {
  it("找出涵蓋這個月的階段", () => {
    expect(phaseOfMonth(phases, "2026-04")?.name).toBe("EFS");
    expect(phaseOfMonth(phases, "2026-07")?.name).toBe("EVT");
  });

  it("階段之外的月份沒有歸屬", () => {
    expect(phaseOfMonth(phases, "2026-12")).toBeNull();
  });
});

describe("buildLabourSheet", () => {
  const slots = [
    // EE1 三月到八月全職 = 6 人月
    slot("ee1", "EE", {
      "2026-03": 1,
      "2026-04": 1,
      "2026-05": 1,
      "2026-06": 1,
      "2026-07": 1,
      "2026-08": 1,
    }),
    // EE2 只有 EVT 那三個月,而且是半個人 = 1.5 人月
    slot("ee2", "EE", { "2026-06": 0.5, "2026-07": 0.5, "2026-08": 0.5 }),
    // ME1 只有 EFS = 3 人月
    slot("me1", "ME", { "2026-03": 1, "2026-04": 1, "2026-05": 1 }),
  ];

  it("一列的人月是它每個月加起來", () => {
    const sheet = buildLabourSheet(phases, slots, rates);
    expect(sheet.slotTotals.find((t) => t.slotId === "ee1")?.personMonths).toBe(6);
    expect(sheet.slotTotals.find((t) => t.slotId === "ee2")?.personMonths).toBe(1.5);
  });

  it("一列的金額 = 人月 × 該單位標準月薪", () => {
    const sheet = buildLabourSheet(phases, slots, rates);
    expect(sheet.slotTotals.find((t) => t.slotId === "me1")?.amount).toBe(3 * 105_000);
  });

  it("單位小計把同單位的名額加起來", () => {
    const sheet = buildLabourSheet(phases, slots, rates);
    const ee = sheet.byDiscipline.find((d) => d.discipline === "EE")!;
    expect(ee.personMonths).toBe(7.5);
    expect(ee.amount).toBe(7.5 * 168_000);
  });

  it("每個月要幾個人,是判斷過不過載的那一列", () => {
    const sheet = buildLabourSheet(phases, slots, rates);
    const ee = sheet.byDiscipline.find((d) => d.discipline === "EE")!;
    expect(ee.byMonth["2026-03"]).toBe(1);
    expect(ee.byMonth["2026-06"]).toBe(1.5);
    // 三月 EE 一個加 ME 一個
    expect(sheet.headcountByMonth["2026-03"]).toBe(2);
  });

  it("階段 × 單位是月份歸戶算出來的,不是另外填的", () => {
    const sheet = buildLabourSheet(phases, slots, rates);
    const efs = sheet.byPhase.find((p) => p.phaseName === "EFS")!;
    const evt = sheet.byPhase.find((p) => p.phaseName === "EVT")!;
    expect(efs.byDiscipline.find((d) => d.discipline === "EE")!.personMonths).toBe(3);
    expect(efs.byDiscipline.find((d) => d.discipline === "ME")!.personMonths).toBe(3);
    expect(evt.byDiscipline.find((d) => d.discipline === "EE")!.personMonths).toBe(4.5);
    expect(evt.byDiscipline.find((d) => d.discipline === "ME")!.personMonths).toBe(0);
  });

  it("階段加總 = 總計,一個人月都沒有漏掉或算兩次", () => {
    const sheet = buildLabourSheet(phases, slots, rates);
    const fromPhases = sheet.byPhase.reduce((t, p) => t + p.personMonths, 0);
    expect(fromPhases).toBe(sheet.totalPersonMonths);
    expect(sheet.totalPersonMonths).toBe(10.5);
  });

  it("落在所有階段之外的月份會被點名 —— 那些人月進不了任何階段預算", () => {
    const sheet = buildLabourSheet(
      phases,
      [...slots, slot("pm1", "PM", { "2026-12": 1 })],
      rates
    );
    expect(sheet.monthsOutsideAnyPhase).toEqual(["2026-12"]);
    // 仍然算進總人月,只是沒有階段收它。
    expect(sheet.totalPersonMonths).toBe(11.5);
    expect(sheet.byPhase.reduce((t, p) => t + p.personMonths, 0)).toBe(10.5);
  });

  it("單位沒有標準月薪的,人月照算,金額是 0,而且點名出來", () => {
    const sheet = buildLabourSheet(phases, [...slots, slot("sw1", "SW", { "2026-06": 2 })], rates);
    expect(sheet.unpricedDisciplines).toEqual(["SW"]);
    expect(sheet.byDiscipline.find((d) => d.discipline === "SW")!.personMonths).toBe(2);
    expect(sheet.byDiscipline.find((d) => d.discipline === "SW")!.amount).toBe(0);
  });

  it("沒有名額的時候全部是 0", () => {
    const sheet = buildLabourSheet(phases, [], rates);
    expect(sheet.totalPersonMonths).toBe(0);
    expect(sheet.totalAmount).toBe(0);
    expect(sheet.months).toHaveLength(6);
  });
});

describe("phaseVariances", () => {
  const slots = [slot("ee1", "EE", { "2026-03": 1, "2026-04": 1, "2026-05": 1 })];
  const sheet = buildLabourSheet(phases, slots, rates);

  it("工期拉長多少天,以及照同樣人力配置會多花多少", () => {
    // EFS 當初排 3/2–5/31(91 天),現在看板算出來到 6/30(121 天)
    const actual = new Map([["i-efs", { start: "2026-03-02", end: "2026-06-30" }]]);
    const [efs] = phaseVariances(phases, sheet.byPhase, actual);

    expect(efs.plannedDays).toBe(91);
    expect(efs.actualDays).toBe(121);
    expect(efs.daysVariance).toBe(30);
    expect(efs.plannedAmount).toBe(3 * 168_000);
    // 工期 121/91,人力成本等比例
    expect(efs.projectedAmount).toBe(Math.round((3 * 168_000 * 121) / 91));
    expect(efs.amountVariance).toBe(efs.projectedAmount! - efs.plannedAmount);
  });

  it("提早完成就是負的差異", () => {
    const actual = new Map([["i-efs", { start: "2026-03-02", end: "2026-05-01" }]]);
    const [efs] = phaseVariances(phases, sheet.byPhase, actual);
    expect(efs.daysVariance).toBeLessThan(0);
    expect(efs.amountVariance).toBeLessThan(0);
  });

  it("沒對上看板階段的,就不假裝比得出來", () => {
    const loose: PhaseRow[] = [
      { id: "x", name: "純預算階段", startDate: "2026-03-01", endDate: "2026-03-31", itemId: null },
    ];
    const [row] = phaseVariances(loose, [], new Map());
    expect(row.actualDays).toBeNull();
    expect(row.daysVariance).toBeNull();
    expect(row.amountVariance).toBeNull();
  });
});

describe("monthKeyOf", () => {
  it("取出年月", () => {
    expect(monthKeyOf("2026-03-16")).toBe("2026-03");
  });
});
