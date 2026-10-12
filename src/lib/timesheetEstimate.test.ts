import { describe, expect, it } from "vitest";
import {
  buildEstimateTable,
  compareHours,
  estimateImportRows,
  isWorkday,
  itemHoursByDay,
  labourHoursByDay,
  summarizeByDay,
  sumHours,
  type ActualEntry,
  type EstimateWeek,
} from "./timesheetEstimate";

// 2026-10-12 是週一。
const WEEK = ["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16", "2026-10-17", "2026-10-18"];
const WORKDAYS = new Set(WEEK.slice(0, 5));

describe("isWorkday", () => {
  it("週一到週五是工作日,週末不是", () => {
    expect(WEEK.map((d) => isWorkday(d, new Set()))).toEqual([true, true, true, true, true, false, false]);
  });

  it("公司假日不是工作日", () => {
    expect(isWorkday("2026-10-13", new Set(["2026-10-13"]))).toBe(false);
  });
});

describe("labourHoursByDay(人力表預估)", () => {
  it("每月投入 × 每日工時,攤到工作日;週末沒有", () => {
    const out = labourHoursByDay({ "2026-10": 0.7 }, WEEK, WORKDAYS, 8);
    expect(out).toEqual({ "2026-10-12": 5.6, "2026-10-13": 5.6, "2026-10-14": 5.6, "2026-10-15": 5.6, "2026-10-16": 5.6 });
    expect(sumHours(out, WEEK)).toBe(28);
  });

  it("跨月的週:每一天用那一天所在月份的投入", () => {
    const days = ["2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02"];
    const out = labourHoursByDay({ "2026-09": 1, "2026-10": 0.5 }, days, new Set(days), 8);
    expect(out).toEqual({ "2026-09-28": 8, "2026-09-29": 8, "2026-09-30": 8, "2026-10-01": 4, "2026-10-02": 4 });
  });

  it("那個月沒有投入、或是 0:沒有預估", () => {
    expect(labourHoursByDay({ "2026-11": 1 }, WEEK, WORKDAYS, 8)).toEqual({});
    expect(labourHoursByDay({ "2026-10": 0 }, WEEK, WORKDAYS, 8)).toEqual({});
  });

  it("公司假日那天不攤", () => {
    const workdays = new Set(["2026-10-12", "2026-10-14"]);
    expect(Object.keys(labourHoursByDay({ "2026-10": 1 }, WEEK, workdays, 8))).toEqual(["2026-10-12", "2026-10-14"]);
  });
});

describe("itemHoursByDay(工作項預估)", () => {
  it("配置比例 × 每日工時,只在工作項起訖之間的工作日", () => {
    const out = itemHoursByDay(50, "2026-10-13", "2026-10-15", WEEK, WORKDAYS, 8);
    expect(out).toEqual({ "2026-10-13": 4, "2026-10-14": 4, "2026-10-15": 4 });
  });

  it("起訖涵蓋週末:週末不攤", () => {
    const out = itemHoursByDay(100, "2026-10-01", "2026-12-31", WEEK, WORKDAYS, 8);
    expect(Object.keys(out)).toHaveLength(5);
  });

  it("起訖完全不在這一週、或配置 0%:空的", () => {
    expect(itemHoursByDay(100, "2026-11-01", "2026-11-30", WEEK, WORKDAYS, 8)).toEqual({});
    expect(itemHoursByDay(0, "2026-10-01", "2026-12-31", WEEK, WORKDAYS, 8)).toEqual({});
  });

  it("2% 的負責人預設比例也算(0.16 小時)", () => {
    expect(itemHoursByDay(2, "2026-10-12", "2026-10-12", WEEK, WORKDAYS, 8)).toEqual({ "2026-10-12": 0.16 });
  });
});

describe("compareHours", () => {
  it("差異 = 實際 − 預估;達成率與剩餘", () => {
    expect(compareHours(28, 12)).toEqual({ estimate: 28, actual: 12, diff: -16, pct: 43, remainingPct: 57 });
  });

  it("超出預估:差異是正的,剩餘是負的", () => {
    expect(compareHours(8, 10)).toEqual({ estimate: 8, actual: 10, diff: 2, pct: 125, remainingPct: -25 });
  });

  it("沒有預估:達成率與剩餘是 null(不顯示 0% 騙人)", () => {
    expect(compareHours(0, 3)).toEqual({ estimate: 0, actual: 3, diff: 3, pct: null, remainingPct: null });
  });

  it("浮點數誤差不會冒出來", () => {
    expect(compareHours(0.1 + 0.2, 0.3).diff).toBe(0);
  });
});

function sampleWeek(): EstimateWeek {
  return {
    weekStart: WEEK[0],
    hoursPerDay: 8,
    workdays: WEEK.slice(0, 5),
    projects: [
      {
        boardId: "b1",
        boardName: "P100 平台",
        slotLabels: ["PM"],
        labour: labourHoursByDay({ "2026-10": 0.5 }, WEEK, WORKDAYS, 8),
        items: [
          { itemId: "i1", itemName: "硬體設計", allocationPct: 50, startDate: "2026-10-12", endDate: "2026-10-16", hours: itemHoursByDay(50, "2026-10-12", "2026-10-16", WEEK, WORKDAYS, 8) },
          { itemId: "i2", itemName: "文件", allocationPct: 25, startDate: "2026-10-14", endDate: "2026-10-15", hours: itemHoursByDay(25, "2026-10-14", "2026-10-15", WEEK, WORKDAYS, 8) },
        ],
      },
      {
        boardId: "b2",
        boardName: "M3",
        slotLabels: [],
        labour: {},
        items: [{ itemId: "i3", itemName: "測試", allocationPct: 100, startDate: "2026-10-12", endDate: "2026-10-12", hours: { "2026-10-12": 8 } }],
      },
    ],
  };
}

const entry = (over: Partial<ActualEntry>): ActualEntry => ({
  date: "2026-10-12",
  hours: 1,
  boardId: "b1",
  boardName: "P100 平台",
  itemId: "i1",
  itemName: "硬體設計",
  ...over,
});

describe("buildEstimateTable", () => {
  const actuals = [
    entry({ hours: 3 }),
    entry({ date: "2026-10-13", hours: 2 }),
    entry({ date: "2026-10-14", hours: 1, itemId: "i2", itemName: "文件" }),
    // 對應 P100 的會議:算專案的實際,沒有工作項。
    entry({ date: "2026-10-14", hours: 1, itemId: null, itemName: null }),
    // 沒有對應專案。
    entry({ date: "2026-10-15", hours: 2, boardId: null, boardName: null, itemId: null, itemName: null }),
  ];

  it("整週:專案一列,人力表預估、工作項預估、實際與各自的差異", () => {
    const table = buildEstimateTable(sampleWeek(), actuals, WEEK);
    const p100 = table.rows.find((r) => r.key === "b1")!;
    expect(p100.labour).toBe(20); // 0.5 × 8 × 5 天
    expect(p100.work).toBe(24); // 硬體設計 4×5 + 文件 2×2
    expect(p100.actual).toBe(7); // 3 + 2 + 1 + 1
    expect(p100.vsLabour).toMatchObject({ diff: -13, pct: 35, remainingPct: 65 });
    expect(p100.vsWork).toMatchObject({ diff: -17, pct: 29, remainingPct: 71 });
    expect(p100.sublabel).toBe("PM");
  });

  it("工作項列:預估與登記在那個工作項上的實際;會議不算在任何工作項", () => {
    const p100 = buildEstimateTable(sampleWeek(), actuals, WEEK).rows.find((r) => r.key === "b1")!;
    const hw = p100.children.find((c) => c.label === "硬體設計")!;
    const doc = p100.children.find((c) => c.label === "文件")!;
    expect([hw.work, hw.actual]).toEqual([20, 5]);
    expect([doc.work, doc.actual]).toEqual([4, 1]);
    expect(hw.labour).toBeNull();
    expect(p100.children.reduce((s, c) => s + c.actual, 0)).toBe(6); // 專案的 7 少了那 1 小時會議
  });

  it("沒有對應專案的工時另外算,不進專案、也不進總計", () => {
    const table = buildEstimateTable(sampleWeek(), actuals, WEEK);
    expect(table.other).toBe(2);
    expect(table.total.actual).toBe(7);
  });

  it("總計是全部專案加起來", () => {
    const table = buildEstimateTable(sampleWeek(), actuals, WEEK);
    expect(table.total.labour).toBe(20);
    expect(table.total.work).toBe(32);
    expect(table.total.vsWork).toMatchObject({ diff: -25, pct: 22 });
  });

  it("只看某一天:只算那一天的預估與實際;那天跟專案無關的列不出現", () => {
    const table = buildEstimateTable(sampleWeek(), actuals, ["2026-10-13"]);
    expect(table.rows.map((r) => r.key)).toEqual(["b1"]);
    const p100 = table.rows[0];
    expect([p100.labour, p100.work, p100.actual]).toEqual([4, 4, 2]);
    expect(p100.children.map((c) => c.label)).toEqual(["硬體設計"]);
  });

  it("登記在沒被指派的專案上:有一列,預估是 0,達成率是 null", () => {
    const stray = [entry({ boardId: "b9", boardName: "別的專案", itemId: "x", itemName: "雜事", hours: 2 })];
    const row = buildEstimateTable(sampleWeek(), stray, WEEK).rows.find((r) => r.key === "b9")!;
    expect([row.labour, row.work, row.actual]).toEqual([0, 0, 2]);
    expect(row.vsLabour!.pct).toBeNull();
    expect(row.children[0]).toMatchObject({ label: "雜事", work: 0, actual: 2 });
  });

  it("什麼都沒登記:實際是 0,剩餘 100%", () => {
    const row = buildEstimateTable(sampleWeek(), [], WEEK).rows.find((r) => r.key === "b1")!;
    expect(row.vsLabour).toMatchObject({ actual: 0, pct: 0, remainingPct: 100 });
  });
});

describe("summarizeByDay", () => {
  const actuals = [
    entry({ hours: 6 }),
    entry({ hours: 1, boardId: null, boardName: null, itemId: null, itemName: null }),
    entry({ date: "2026-10-17", hours: 3 }), // 週六加班
  ];
  const days = summarizeByDay(sampleWeek(), actuals, WEEK);

  it("每天一列:人力表預估、工作項預估", () => {
    expect(days[0]).toMatchObject({ date: "2026-10-12", workday: true, labour: 4, work: 12 }); // 硬體 4 + M3 測試 8
    expect(days[2]).toMatchObject({ labour: 4, work: 6 }); // 硬體 4 + 文件 2
  });

  it("實際只算有對應專案的,其他另外列;差異與達成率對兩種預估各算一次", () => {
    expect(days[0]).toMatchObject({ actual: 6, other: 1 });
    expect(days[0].vsLabour).toMatchObject({ diff: 2, pct: 150, remainingPct: -50 });
    expect(days[0].vsWork).toMatchObject({ diff: -6, pct: 50, remainingPct: 50 });
  });

  it("週末:沒有預估,加班的實際照列,達成率是 null", () => {
    expect(days[5]).toMatchObject({ workday: false, labour: 0, work: 0, actual: 3 });
    expect(days[5].vsLabour.pct).toBeNull();
  });
});

describe("estimateImportRows(從工作項預估匯入工時的清單)", () => {
  const week = sampleWeek();

  it("每個工作項、每一天一列:日期、專案、工作項與預估時數", () => {
    const rows = estimateImportRows(week.projects, WEEK);
    // 硬體設計 週一到週五各 4 小時(5 列)、文件 週三週四各 2 小時(2 列)、M3 測試 週一 8 小時(1 列)
    expect(rows).toHaveLength(8);
    expect(rows[0]).toMatchObject({ date: "2026-10-12", boardName: "M3", itemName: "測試", estimateHours: 8, key: "i3|2026-10-12" });
  });

  it("照日期排;同一天照專案與工作項名稱", () => {
    const rows = estimateImportRows(week.projects, WEEK);
    expect(rows.map((r) => r.date)).toEqual([...rows.map((r) => r.date)].sort());
    const wed = rows.filter((r) => r.date === "2026-10-14").map((r) => r.itemName);
    expect(wed).toEqual(["文件", "硬體設計"].sort((a, b) => a.localeCompare(b, "zh-TW")));
  });

  it("只列要匯入的那幾天;週末與沒有預估的天不會有列", () => {
    const rows = estimateImportRows(week.projects, ["2026-10-17", "2026-10-18"]);
    expect(rows).toEqual([]);
    expect(estimateImportRows(week.projects, ["2026-10-13"]).map((r) => r.itemName)).toEqual(["硬體設計"]);
  });

  it("預估太小(< 0.25 小時)的不列", () => {
    const tiny = [{ ...week.projects[0], items: [{ ...week.projects[0].items[0], hours: { "2026-10-12": 0.16, "2026-10-13": 0.25 } }] }];
    expect(estimateImportRows(tiny, WEEK).map((r) => r.date)).toEqual(["2026-10-13"]);
  });
});
