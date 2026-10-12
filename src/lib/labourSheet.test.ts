import { describe, expect, it } from "vitest";
import {
  buildLabourSheet,
  slotRatesFromSalaries,
  monthAxis,
  monthKeyOf,
  phaseOfMonth,
  phaseVariances,
  type PhaseRow,
  type SlotRow,
  packBandRows,
  buildAxis,
  axisSpan,
  monthColumnSpans,
  isoWeekNumber,
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
  userId: null,
  ownerName: "TBH",
  description: "",
  months,
});

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

  it("欄位跟著設定的單位走,不是寫死的那六個", () => {
    // 公司新增一個 FAE,人力表就該多一欄 —— 這是把列舉換成資料表的整個理由。
    const units = [
      { code: "EE", label: "EE 電機", order: 0 },
      { code: "FAE", label: "FAE 技術支援", order: 1 },
    ];
    const sheet = buildLabourSheet(phases, slots, rates, units);
    expect(sheet.byDiscipline.map((d) => d.discipline)).toEqual(["EE", "FAE"]);
    expect(sheet.byPhase[0].byDiscipline.map((d) => d.discipline)).toEqual(["EE", "FAE"]);
  });

  it("名額的單位不在設定裡,它的人月就不會出現在任何一欄", () => {
    // ME 從設定裡拿掉了,但 me1 這個名額還在。小計不該憑空生出一個 ME 欄,
    // 也不該把它的人月偷偷算到別欄頭上。
    const units = [{ code: "EE", label: "EE 電機", order: 0 }];
    const sheet = buildLabourSheet(phases, slots, rates, units);
    expect(sheet.byDiscipline.map((d) => d.discipline)).toEqual(["EE"]);
    expect(sheet.totalPersonMonths).toBe(7.5);
    // 但它的那一列本身還是算得出人月 —— 名額沒有消失,只是沒有欄收它。
    expect(sheet.slotTotals.find((t) => t.slotId === "me1")?.personMonths).toBe(3);
  });

  it("一列的人月是它每個月加起來", () => {
    const sheet = buildLabourSheet(phases, slots, rates, UNITS);
    expect(sheet.slotTotals.find((t) => t.slotId === "ee1")?.personMonths).toBe(6);
    expect(sheet.slotTotals.find((t) => t.slotId === "ee2")?.personMonths).toBe(1.5);
  });

  it("一列的金額 = 人月 × 該單位標準月薪", () => {
    const sheet = buildLabourSheet(phases, slots, rates, UNITS);
    expect(sheet.slotTotals.find((t) => t.slotId === "me1")?.amount).toBe(3 * 105_000);
  });

  it("單位小計把同單位的名額加起來", () => {
    const sheet = buildLabourSheet(phases, slots, rates, UNITS);
    const ee = sheet.byDiscipline.find((d) => d.discipline === "EE")!;
    expect(ee.personMonths).toBe(7.5);
    expect(ee.amount).toBe(7.5 * 168_000);
  });

  it("每個月要幾個人,是判斷過不過載的那一列", () => {
    const sheet = buildLabourSheet(phases, slots, rates, UNITS);
    const ee = sheet.byDiscipline.find((d) => d.discipline === "EE")!;
    expect(ee.byMonth["2026-03"]).toBe(1);
    expect(ee.byMonth["2026-06"]).toBe(1.5);
    // 三月 EE 一個加 ME 一個
    expect(sheet.headcountByMonth["2026-03"]).toBe(2);
  });

  it("階段 × 單位是月份歸戶算出來的,不是另外填的", () => {
    const sheet = buildLabourSheet(phases, slots, rates, UNITS);
    const efs = sheet.byPhase.find((p) => p.phaseName === "EFS")!;
    const evt = sheet.byPhase.find((p) => p.phaseName === "EVT")!;
    expect(efs.byDiscipline.find((d) => d.discipline === "EE")!.personMonths).toBe(3);
    expect(efs.byDiscipline.find((d) => d.discipline === "ME")!.personMonths).toBe(3);
    expect(evt.byDiscipline.find((d) => d.discipline === "EE")!.personMonths).toBe(4.5);
    expect(evt.byDiscipline.find((d) => d.discipline === "ME")!.personMonths).toBe(0);
  });

  it("階段加總 = 總計,一個人月都沒有漏掉或算兩次", () => {
    const sheet = buildLabourSheet(phases, slots, rates, UNITS);
    const fromPhases = sheet.byPhase.reduce((t, p) => t + p.personMonths, 0);
    expect(fromPhases).toBe(sheet.totalPersonMonths);
    expect(sheet.totalPersonMonths).toBe(10.5);
  });

  it("落在所有階段之外的月份會被點名 —— 那些人月進不了任何階段預算", () => {
    const sheet = buildLabourSheet(
      phases,
      [...slots, slot("pm1", "PM", { "2026-12": 1 })],
      rates,
      UNITS
    );
    expect(sheet.monthsOutsideAnyPhase).toEqual(["2026-12"]);
    // 仍然算進總人月,只是沒有階段收它。
    expect(sheet.totalPersonMonths).toBe(11.5);
    expect(sheet.byPhase.reduce((t, p) => t + p.personMonths, 0)).toBe(10.5);
  });

  it("單位沒有標準月薪的,人月照算,金額是 0,而且點名出來", () => {
    const sheet = buildLabourSheet(phases, [...slots, slot("sw1", "SW", { "2026-06": 2 })], rates, UNITS);
    expect(sheet.unpricedDisciplines).toEqual(["SW"]);
    expect(sheet.byDiscipline.find((d) => d.discipline === "SW")!.personMonths).toBe(2);
    expect(sheet.byDiscipline.find((d) => d.discipline === "SW")!.amount).toBe(0);
  });

  it("沒有名額的時候全部是 0", () => {
    const sheet = buildLabourSheet(phases, [], rates, UNITS);
    expect(sheet.totalPersonMonths).toBe(0);
    expect(sheet.totalAmount).toBe(0);
    expect(sheet.months).toHaveLength(6);
  });
});

describe("個人月薪(有指到人、設了月薪的名額用他的月薪算)", () => {
  const slots = [
    // EE1 三到八月全職 = 6 人月,指到某個人
    slot("ee1", "EE", { "2026-03": 1, "2026-04": 1, "2026-05": 1, "2026-06": 1, "2026-07": 1, "2026-08": 1 }),
    // EE2 還沒指人:EVT 三個月半個人 = 1.5 人月,用單位標準月薪
    slot("ee2", "EE", { "2026-06": 0.5, "2026-07": 0.5, "2026-08": 0.5 }),
  ];

  it("slotRatesFromSalaries:只有指到人而且設了月薪(> 0)的名額會出現", () => {
    const withUser = (id: string, userId: string | null) => ({ id, userId });
    expect(
      slotRatesFromSalaries([withUser("a", "u1"), withUser("b", "u2"), withUser("c", null), withUser("d", "u3")], {
        u1: 150_000,
        u2: 0,
        u3: 90_000,
      })
    ).toEqual({ a: 150_000, d: 90_000 });
  });

  it("名額的金額 = 人月 × 那個人的月薪,不是單位標準月薪;沒指人的還是單位標準", () => {
    const sheet = buildLabourSheet(phases, slots, rates, UNITS, { ee1: 150_000 });
    const total = (id: string) => sheet.slotTotals.find((t) => t.slotId === id)!;
    expect(total("ee1")).toMatchObject({ personMonths: 6, amount: 900_000, personal: true });
    expect(total("ee2")).toMatchObject({ personMonths: 1.5, amount: 252_000, personal: false }); // 1.5 × 168,000
  });

  it("單位小計、階段 × 單位、總計都跟著:一個單位裡兩種算法的名額加起來", () => {
    const sheet = buildLabourSheet(phases, slots, rates, UNITS, { ee1: 150_000 });
    expect(sheet.byDiscipline.find((d) => d.discipline === "EE")!.amount).toBe(900_000 + 252_000);
    // EFS(三到五月):ee1 三個月 = 450,000;EVT(六到八月):ee1 450,000 + ee2 1.5 × 168,000
    const efs = sheet.byPhase.find((p) => p.phaseId === "efs")!;
    const evt = sheet.byPhase.find((p) => p.phaseId === "evt")!;
    expect(efs.amount).toBe(450_000);
    expect(evt.amount).toBe(450_000 + 252_000);
    expect(sheet.totalAmount).toBe(efs.amount + evt.amount);
  });

  it("改了月薪,金額就變——這就是改月薪人力預算要跟著變", () => {
    const at = (salary: number) => buildLabourSheet(phases, slots, rates, UNITS, { ee1: salary }).totalAmount;
    expect(at(200_000) - at(150_000)).toBe(6 * 50_000);
  });

  it("沒有給個人月薪時,跟原本一樣(單位標準月薪)", () => {
    expect(buildLabourSheet(phases, slots, rates, UNITS).totalAmount).toBe(buildLabourSheet(phases, slots, rates, UNITS, {}).totalAmount);
    expect(buildLabourSheet(phases, slots, rates, UNITS).totalAmount).toBe(7.5 * 168_000);
  });

  it("單位沒有標準月薪,但名額指到有月薪的人:算得出錢,不算「未定價」", () => {
    const sheet = buildLabourSheet(phases, [slot("sw1", "SW", { "2026-06": 2 })], rates, UNITS, { sw1: 120_000 });
    expect(sheet.byDiscipline.find((d) => d.discipline === "SW")!.amount).toBe(240_000);
    expect(sheet.unpricedDisciplines).toEqual([]);
  });

  it("單位沒有標準月薪、名額也沒有個人月薪:還是點名未定價", () => {
    const sheet = buildLabourSheet(phases, [slot("sw1", "SW", { "2026-06": 2 })], rates, UNITS, {});
    expect(sheet.unpricedDisciplines).toEqual(["SW"]);
  });
});

describe("phaseVariances", () => {
  const slots = [slot("ee1", "EE", { "2026-03": 1, "2026-04": 1, "2026-05": 1 })];
  const sheet = buildLabourSheet(phases, slots, rates, UNITS);

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

describe("packBandRows", () => {
  const band = (id: string, startDate: string, endDate: string) => ({
    id,
    name: id,
    startDate,
    endDate,
    color: "#fff",
  });
  /** 用這幾條帶自己的範圍當軸。 */
  const pack = (bands: ReturnType<typeof band>[], unit: "month" | "week" = "month") =>
    packBandRows(bands, buildAxis(bands, unit), unit);

  it("軸上分得開的排同一列", () => {
    const rows = pack([
      band("a", "2026-03-01", "2026-03-31"),
      band("b", "2026-06-01", "2026-06-30"),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].map((b) => b.id)).toEqual(["a", "b"]);
  });

  it("重疊的往下疊一列", () => {
    const rows = pack([
      band("a", "2026-03-01", "2026-05-31"),
      band("b", "2026-05-01", "2026-07-31"),
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0].map((b) => b.id)).toEqual(["a"]);
    expect(rows[1].map((b) => b.id)).toEqual(["b"]);
  });

  it("首尾相接的階段在月刻度下各佔各的欄,同一列即可 —— 靠顏色分辨", () => {
    // EFS 到 5/31、EVT 從 6/1:欄位是 [03,04,05] 與 [06,07,08],沒有交集。
    const rows = pack([
      band("EFS", "2026-03-02", "2026-05-31"),
      band("EVT", "2026-06-01", "2026-08-31"),
    ]);
    expect(rows).toHaveLength(1);
  });

  it("日期沒重疊但落在同一個月,仍然要分列 —— 畫出來是疊在一起的", () => {
    const rows = pack([
      band("a", "2026-03-01", "2026-05-15"),
      band("b", "2026-05-20", "2026-07-31"),
    ]);
    expect(rows).toHaveLength(2);
  });

  it("換成週刻度,同月但不同週就分得開了", () => {
    const rows = pack(
      [band("a", "2026-03-01", "2026-05-15"), band("b", "2026-05-20", "2026-07-31")],
      "week"
    );
    expect(rows).toHaveLength(1);
  });

  it("三個互相重疊就三列", () => {
    const rows = pack([
      band("a", "2026-03-01", "2026-08-31"),
      band("b", "2026-04-01", "2026-09-30"),
      band("c", "2026-05-01", "2026-10-31"),
    ]);
    expect(rows).toHaveLength(3);
  });

  it("空的就沒有列", () => {
    expect(packBandRows([], [], "month")).toEqual([]);
  });
});

describe("buildAxis", () => {
  const span = [{ startDate: "2026-03-02", endDate: "2026-05-31" }];

  it("月刻度跟 monthAxis 一樣", () => {
    expect(buildAxis(span, "month")).toEqual(["2026-03", "2026-04", "2026-05"]);
  });

  it("週刻度每欄是一個週一", () => {
    const axis = buildAxis(span, "week");
    expect(axis[0]).toBe("2026-03-02");
    expect(axis.every((d) => new Date(`${d}T00:00:00Z`).getUTCDay() === 1)).toBe(true);
    // 三個月大約十三週,而且一定涵蓋到結束日那一週。
    expect(axis.length).toBeGreaterThan(11);
    expect(axis[axis.length - 1] >= "2026-05-25").toBe(true);
  });

  it("沒有階段就沒有欄位", () => {
    expect(buildAxis([], "week")).toEqual([]);
    expect(buildAxis([], "month")).toEqual([]);
  });
});

describe("axisSpan", () => {
  const phases = [{ startDate: "2026-03-02", endDate: "2026-08-31" }];

  it("月刻度下算出起訖欄", () => {
    const axis = buildAxis(phases, "month");
    expect(axisSpan(axis, "month", "2026-04-01", "2026-05-31")).toEqual({ from: 1, to: 2 });
  });

  it("週刻度下也算得出來", () => {
    const axis = buildAxis(phases, "week");
    // 03-15 是禮拜天,屬於 03-09 開始的那一週,所以是第 1 欄不是第 2 欄。
    const span = axisSpan(axis, "week", "2026-03-02", "2026-03-15");
    expect(span).toEqual({ from: 0, to: 1 });
  });

  it("超出軸的左右兩端就夾到邊界,而不是整段消失", () => {
    const axis = buildAxis(phases, "month");
    expect(axisSpan(axis, "month", "2025-01-01", "2026-04-30")).toEqual({ from: 0, to: 1 });
    expect(axisSpan(axis, "month", "2026-07-01", "2027-12-31")).toEqual({ from: 4, to: 5 });
  });

  it("軸是空的就沒有位置", () => {
    expect(axisSpan([], "month", "2026-03-01", "2026-03-31")).toBeNull();
  });
});

describe("monthColumnSpans", () => {
  const phases = [{ startDate: "2026-03-02", endDate: "2026-05-31" }];

  it("月刻度下一個月就是一欄", () => {
    const axis = buildAxis(phases, "month");
    expect(monthColumnSpans(axis, "month", axis)).toEqual([
      { month: "2026-03", from: 0, to: 0 },
      { month: "2026-04", from: 1, to: 1 },
      { month: "2026-05", from: 2, to: 2 },
    ]);
  });

  it("週刻度下每一欄只屬於一個月,而且恰好鋪滿整條軸", () => {
    const axis = buildAxis(phases, "week");
    const months = monthAxis(phases);
    const spans = monthColumnSpans(axis, "week", months);

    // 首尾相接、不重疊、不留縫。
    expect(spans[0].from).toBe(0);
    expect(spans[spans.length - 1].to).toBe(axis.length - 1);
    for (let i = 1; i < spans.length; i++) {
      expect(spans[i].from).toBe(spans[i - 1].to + 1);
    }
  });

  it("跨月的那一週整欄算給開始日的月份", () => {
    // 2026-03-30 那一週跨到 4/5,整欄算三月。
    const axis = buildAxis([{ startDate: "2026-03-30", endDate: "2026-04-10" }], "week");
    const spans = monthColumnSpans(axis, "week", ["2026-03", "2026-04"]);
    expect(axis[0]).toBe("2026-03-30");
    expect(spans.find((s) => s.month === "2026-03")).toEqual({ month: "2026-03", from: 0, to: 0 });
  });
});

describe("isoWeekNumber", () => {
  it("年初與年末", () => {
    expect(isoWeekNumber("2026-01-01")).toBe(1);
    expect(isoWeekNumber("2026-12-28")).toBe(53);
  });

  it("同一週的任一天都是同一個週數", () => {
    expect(isoWeekNumber("2026-03-02")).toBe(isoWeekNumber("2026-03-08"));
  });

  it("往後一週就加一", () => {
    expect(isoWeekNumber("2026-03-09")).toBe(isoWeekNumber("2026-03-02") + 1);
  });
});
