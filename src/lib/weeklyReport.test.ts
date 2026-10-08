import { describe, it, expect } from "vitest";
import {
  weekRangeOf,
  previousWeekOf,
  isPastWeeklyTrigger,
  isoWeekLabel,
  diffWeeks,
  renderWeeklyReportMarkdown,
  groupItemUpdates,
  updatesByItem,
  programSubset,
  weeklyReportSubject,
  DEFAULT_REPORT_RANGE,
  lastCompletedReportRange,
  previousReportWeekStart,
  reportRangeDays,
  reportRangeOf,
  reportWeekLabel,
  type BudgetLine,
  type ItemUpdateLine,
  type PersonSection,
  type ProgramSection,
  type ReportItem,
  type RiskLine,
  type WeeklyReportData,
} from "@/lib/weeklyReport";

function item(overrides: Partial<ReportItem> & { id: string }): ReportItem {
  return {
    wbsCode: "1.1",
    name: overrides.id,
    boardName: "M3專案",
    groupName: "M3",
    programName: "M3",
    start: "2026-09-10",
    end: "2026-09-18",
    status: "In Progress",
    ownerIds: ["u1"],
    ownerNames: ["Henry"],
    isMilestone: false,
    isCritical: false,
    priority: null,
    bucket: "other",
    ...overrides,
  };
}

const budget = (overrides: Partial<BudgetLine> & { itemId: string }): BudgetLine => ({
  boardName: "M3專案",
  phaseName: "EFS",
  approved: 1_000_000,
  spent: 100_000,
  committed: 0,
  remaining: 900_000,
  over: false,
  ...overrides,
});

const risk = (overrides: Partial<RiskLine> & { id: string }): RiskLine => ({
  boardName: "M3專案",
  programName: "M3",
  kind: "RISK",
  status: "OPEN",
  title: overrides.id,
  probability: 3,
  impact: 3,
  ownerName: null,
  dueDate: null,
  updatedAt: "2026-09-21T00:00:00.000Z",
  ...overrides,
});

const program = (items: ReportItem[], budgets: BudgetLine[] = [], risks: RiskLine[] = []): ProgramSection => ({
  programName: "M3",
  boards: [
    {
      boardId: "b1",
      boardName: "M3專案",
      programName: "M3",
      total: 10,
      done: 4,
      overdue: 2,
      inProgress: 3,
      notStarted: 1,
    },
  ],
  items,
  budgets,
  delays: [],
  risks,
});

const snapshot = (items: ReportItem[], budgets: BudgetLine[] = [], risks: RiskLine[] = []): WeeklyReportData => ({
  weekStart: "2026-09-14",
  weekEnd: "2026-09-20",
  generatedAt: "2026-09-21 08:00",
  viewerName: "Stanley Huang",
  programs: [program(items, budgets, risks)],
  departments: [],
  upcomingDays: 7,
  activity: [],
});

describe("一週的邊界", () => {
  it("週三落在那一週的週一到週日", () => {
    expect(weekRangeOf("2026-09-16")).toEqual({ weekStart: "2026-09-14", weekEnd: "2026-09-20" });
  });

  it("週一就是自己", () => {
    expect(weekRangeOf("2026-09-14").weekStart).toBe("2026-09-14");
  });

  it("週日算在前面那一週,不是下一週的開頭", () => {
    // getUTCDay 的週日是 0,直接減會把整週算錯 —— 這是最容易寫錯的那一天。
    expect(weekRangeOf("2026-09-20")).toEqual({ weekStart: "2026-09-14", weekEnd: "2026-09-20" });
  });

  it("跨月也對", () => {
    expect(weekRangeOf("2026-10-01")).toEqual({ weekStart: "2026-09-28", weekEnd: "2026-10-04" });
  });

  it("上一週就是退七天", () => {
    expect(previousWeekOf("2026-09-14")).toEqual({ weekStart: "2026-09-07", weekEnd: "2026-09-13" });
  });

  it("跨年的上一週不會跳掉", () => {
    expect(previousWeekOf("2027-01-04").weekStart).toBe("2026-12-28");
  });
});

describe("isPastWeeklyTrigger", () => {
  const trigger = { dow: 1, hour: 6, minute: 0 }; // 每週一 06:00

  it("還沒到那一天", () => {
    expect(isPastWeeklyTrigger({ dow: 0, hour: 23, minute: 59 }, trigger)).toBe(false);
  });

  it("過了那一天", () => {
    expect(isPastWeeklyTrigger({ dow: 2, hour: 0, minute: 0 }, trigger)).toBe(true);
  });

  it("同一天,時間還沒到", () => {
    expect(isPastWeeklyTrigger({ dow: 1, hour: 5, minute: 59 }, trigger)).toBe(false);
  });

  it("同一天,剛好是那一分鐘算已經到", () => {
    expect(isPastWeeklyTrigger({ dow: 1, hour: 6, minute: 0 }, trigger)).toBe(true);
  });

  it("同一天,時間已經過了", () => {
    expect(isPastWeeklyTrigger({ dow: 1, hour: 6, minute: 1 }, trigger)).toBe(true);
    expect(isPastWeeklyTrigger({ dow: 1, hour: 23, minute: 0 }, trigger)).toBe(true);
  });
});

describe("ISO 週數", () => {
  it("一般情況", () => {
    expect(isoWeekLabel("2026-09-14")).toBe("2026 W38");
  });

  it("年初那一週歸給週四所在的那一年", () => {
    expect(isoWeekLabel("2026-12-28")).toBe("2026 W53");
  });

  it("跨年後第一週", () => {
    expect(isoWeekLabel("2027-01-04")).toBe("2027 W01");
  });
});

describe("跟上一週比", () => {
  it("沒有上一週就什麼都不宣稱", () => {
    const diff = diffWeeks(snapshot([item({ id: "a", bucket: "done" })]), null);
    expect(diff.firstEver).toBe(true);
    expect(diff.completed).toEqual([]);
  });

  it("上週沒有工作項不代表整個不能比 —— 預算可能動了", () => {
    // 舊版格式擋在 loadSnapshot(沒有 programs 就回 null),不是擋在這裡。
    // 早期用 before.length === 0 當擋板,結果只有預算變動的那一週什麼都不報。
    const diff = diffWeeks(
      snapshot([], [budget({ itemId: "p1", spent: 500 })]),
      snapshot([], [budget({ itemId: "p1", spent: 100 })])
    );
    expect(diff.firstEver).toBe(false);
    expect(diff.budgetChanged).toHaveLength(1);
  });

  it("這週是完成、上週不是 = 這週完成的", () => {
    const diff = diffWeeks(
      snapshot([item({ id: "a", bucket: "done" })]),
      snapshot([item({ id: "a", bucket: "other" })])
    );
    expect(diff.completed.map((i) => i.id)).toEqual(["a"]);
  });

  it("上週就完成的不會再算一次", () => {
    const diff = diffWeeks(
      snapshot([item({ id: "a", bucket: "done" })]),
      snapshot([item({ id: "a", bucket: "done" })])
    );
    expect(diff.completed).toEqual([]);
  });

  it("這週才新增的項目不算變化 —— 它沒有「之前」", () => {
    const diff = diffWeeks(
      snapshot([item({ id: "a", bucket: "done" }), item({ id: "new", bucket: "done" })]),
      snapshot([item({ id: "a", bucket: "done" })])
    );
    expect(diff.completed).toEqual([]);
  });

  it("這週逾期、上週不逾期 = 新逾期", () => {
    const diff = diffWeeks(
      snapshot([item({ id: "a", bucket: "overdue" })]),
      snapshot([item({ id: "a", bucket: "other" })])
    );
    expect(diff.newlyOverdue.map((i) => i.id)).toEqual(["a"]);
  });

  it("上週逾期、這週不逾期 = 脫離逾期", () => {
    const diff = diffWeeks(
      snapshot([item({ id: "a", bucket: "other" })]),
      snapshot([item({ id: "a", bucket: "overdue" })])
    );
    expect(diff.recovered.map((i) => i.id)).toEqual(["a"]);
  });

  it("做完的不算「脫離逾期」—— 它已經在完成那一欄了", () => {
    const diff = diffWeeks(
      snapshot([item({ id: "a", bucket: "done" })]),
      snapshot([item({ id: "a", bucket: "overdue" })])
    );
    expect(diff.completed.map((i) => i.id)).toEqual(["a"]);
    expect(diff.recovered).toEqual([]);
  });
});

describe("狀態變化", () => {
  it("狀態換了就記下來,前後都留著", () => {
    const diff = diffWeeks(
      snapshot([item({ id: "a", status: "Stuck" })]),
      snapshot([item({ id: "a", status: "In Progress" })])
    );
    expect(diff.statusChanged).toEqual([
      { item: expect.objectContaining({ id: "a" }), from: "In Progress", to: "Stuck" },
    ]);
  });

  it("變成完成的那一筆不會同時出現在狀態更新 —— 同一件事講兩次", () => {
    const diff = diffWeeks(
      snapshot([item({ id: "a", status: "Done", bucket: "done" })]),
      snapshot([item({ id: "a", status: "In Progress", bucket: "other" })])
    );
    expect(diff.completed.map((i) => i.id)).toEqual(["a"]);
    expect(diff.statusChanged).toEqual([]);
  });

  it("狀態沒動就不記", () => {
    const diff = diffWeeks(snapshot([item({ id: "a" })]), snapshot([item({ id: "a" })]));
    expect(diff.statusChanged).toEqual([]);
  });
});

describe("時程變化", () => {
  it("結束日往後 = 延後幾天", () => {
    const diff = diffWeeks(
      snapshot([item({ id: "a", end: "2026-09-25" })]),
      snapshot([item({ id: "a", end: "2026-09-18" })])
    );
    expect(diff.scheduleChanged[0].slipDays).toBe(7);
  });

  it("結束日往前是負的,排版時會講成提前", () => {
    const diff = diffWeeks(
      snapshot([item({ id: "a", end: "2026-09-15" })]),
      snapshot([item({ id: "a", end: "2026-09-18" })])
    );
    expect(diff.scheduleChanged[0].slipDays).toBe(-3);
  });

  it("只改開始日也算改期", () => {
    const diff = diffWeeks(
      snapshot([item({ id: "a", start: "2026-09-12" })]),
      snapshot([item({ id: "a", start: "2026-09-10" })])
    );
    expect(diff.scheduleChanged).toHaveLength(1);
    expect(diff.scheduleChanged[0].slipDays).toBe(0);
  });

  it("日期從沒有變成有,算得出是改期但算不出差幾天", () => {
    const diff = diffWeeks(
      snapshot([item({ id: "a", end: "2026-09-18" })]),
      snapshot([item({ id: "a", end: null })])
    );
    expect(diff.scheduleChanged[0].slipDays).toBe(null);
  });

  it("日期沒動就不記", () => {
    const diff = diffWeeks(snapshot([item({ id: "a" })]), snapshot([item({ id: "a" })]));
    expect(diff.scheduleChanged).toEqual([]);
  });
});

describe("預算變化", () => {
  it("花費變了就記,前後都留著", () => {
    const diff = diffWeeks(
      snapshot([], [budget({ itemId: "p1", spent: 300_000 })]),
      snapshot([], [budget({ itemId: "p1", spent: 100_000 })])
    );
    expect(diff.budgetChanged[0].fromSpent).toBe(100_000);
    expect(diff.budgetChanged[0].line.spent).toBe(300_000);
  });

  it("這週才開始超支的會被點名", () => {
    const diff = diffWeeks(
      snapshot([], [budget({ itemId: "p1", spent: 1_200_000, over: true })]),
      snapshot([], [budget({ itemId: "p1", spent: 100_000, over: false })])
    );
    expect(diff.budgetChanged[0].newlyOver).toBe(true);
  });

  it("本來就超支的不算「開始超支」", () => {
    const diff = diffWeeks(
      snapshot([], [budget({ itemId: "p1", spent: 1_300_000, over: true })]),
      snapshot([], [budget({ itemId: "p1", spent: 1_200_000, over: true })])
    );
    expect(diff.budgetChanged[0].newlyOver).toBe(false);
  });

  it("金額沒動就不記", () => {
    const diff = diffWeeks(
      snapshot([], [budget({ itemId: "p1" })]),
      snapshot([], [budget({ itemId: "p1" })])
    );
    expect(diff.budgetChanged).toEqual([]);
  });
});

describe("里程碑/要徑標記的變化", () => {
  it("上週不是里程碑、這週是 = 新增標記", () => {
    const diff = diffWeeks(
      snapshot([item({ id: "a", isMilestone: true })]),
      snapshot([item({ id: "a", isMilestone: false })])
    );
    expect(diff.milestoneFlagged.map((i) => i.id)).toEqual(["a"]);
  });

  it("上週就是里程碑的不會再算一次", () => {
    const diff = diffWeeks(
      snapshot([item({ id: "a", isMilestone: true })]),
      snapshot([item({ id: "a", isMilestone: true })])
    );
    expect(diff.milestoneFlagged).toEqual([]);
  });

  it("要徑也是同一套規則", () => {
    const diff = diffWeeks(
      snapshot([item({ id: "a", isCritical: true })]),
      snapshot([item({ id: "a", isCritical: false })])
    );
    expect(diff.criticalFlagged.map((i) => i.id)).toEqual(["a"]);
  });
});

describe("風險/議題變化", () => {
  it("上週名單裡沒有這個 id = 新增", () => {
    const diff = diffWeeks(snapshot([], [], [risk({ id: "r1" })]), snapshot([], [], []));
    expect(diff.riskAdded.map((r) => r.id)).toEqual(["r1"]);
  });

  it("狀態換了就記,前後都留著", () => {
    const diff = diffWeeks(
      snapshot([], [], [risk({ id: "r1", status: "MITIGATING" })]),
      snapshot([], [], [risk({ id: "r1", status: "OPEN" })])
    );
    expect(diff.riskStatusChanged).toEqual([
      { line: expect.objectContaining({ id: "r1" }), from: "OPEN", to: "MITIGATING" },
    ]);
  });

  it("狀態沒變,但內容動過(updatedAt 變新)算更新", () => {
    const diff = diffWeeks(
      snapshot([], [], [risk({ id: "r1", updatedAt: "2026-09-22T00:00:00.000Z" })]),
      snapshot([], [], [risk({ id: "r1", updatedAt: "2026-09-10T00:00:00.000Z" })])
    );
    expect(diff.riskUpdated.map((r) => r.id)).toEqual(["r1"]);
  });

  it("狀態改變的不會又被算成更新", () => {
    const diff = diffWeeks(
      snapshot([], [], [risk({ id: "r1", status: "CLOSED", updatedAt: "2026-09-22T00:00:00.000Z" })]),
      snapshot([], [], [risk({ id: "r1", status: "OPEN", updatedAt: "2026-09-10T00:00:00.000Z" })])
    );
    expect(diff.riskStatusChanged).toHaveLength(1);
    expect(diff.riskUpdated).toEqual([]);
  });

  it("什麼都沒變就不記", () => {
    const diff = diffWeeks(snapshot([], [], [risk({ id: "r1" })]), snapshot([], [], [risk({ id: "r1" })]));
    expect(diff.riskAdded).toEqual([]);
    expect(diff.riskStatusChanged).toEqual([]);
    expect(diff.riskUpdated).toEqual([]);
  });
});

describe("Markdown", () => {
  const noDiff = diffWeeks(snapshot([]), null);

  it("標題帶週數與起訖", () => {
    const md = renderWeeklyReportMarkdown(snapshot([]), noDiff);
    expect(md.startsWith("# 週報 2026 W38(2026-09-14 ~ 2026-09-20)")).toBe(true);
  });

  it("第一份會說清楚沒得比,而不是留一排 0", () => {
    const md = renderWeeklyReportMarkdown(snapshot([]), noDiff);
    expect(md).toContain("這是第一份週報");
    expect(md).not.toContain("完成 0・");
  });

  it("分專案排,標題帶專案名稱", () => {
    const md = renderWeeklyReportMarkdown(snapshot([]), noDiff);
    expect(md).toContain("## 專案:M3");
  });

  it("沒有歸屬專案群組的看板會有自己一段,不會消失", () => {
    const data = snapshot([]);
    data.programs.push({ ...program([]), programName: null });
    const md = renderWeeklyReportMarkdown(data, noDiff);
    expect(md).toContain("(未歸屬專案群組的看板)");
  });

  it("里程碑與要徑各自一段", () => {
    const md = renderWeeklyReportMarkdown(
      snapshot([
        item({ id: "m", name: "EVT 出樣", isMilestone: true }),
        item({ id: "c", name: "PCBA", isCritical: true }),
      ]),
      noDiff
    );
    expect(md).toContain("### 里程碑(1)");
    expect(md).toContain("### 要徑(1)");
    expect(md).toContain("🚩里程碑");
    expect(md).toContain("⚡要徑");
  });

  it("工作項依 Priority 排序,CRITICAL 排最前、沒設定的排最後", () => {
    const md = renderWeeklyReportMarkdown(
      snapshot([
        item({ id: "n", name: "普通件", bucket: "overdue", priority: "NORMAL" }),
        item({ id: "u", name: "沒設定", bucket: "overdue", priority: null }),
        item({ id: "c", name: "急件", bucket: "overdue", priority: "CRITICAL" }),
        item({ id: "h", name: "高優先", bucket: "overdue", priority: "HIGH" }),
      ]),
      noDiff
    );
    const order = ["急件", "高優先", "普通件", "沒設定"].map((name) => md.indexOf(name));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(md).toContain("🔴CRITICAL");
    expect(md).toContain("🟣HIGH");
  });

  it("風險/議題:有登記的會報目前狀態,也列這週的異動", () => {
    const now = snapshot([], [], [risk({ id: "r1", kind: "ISSUE", status: "MITIGATING", title: "供應商延遲交貨" })]);
    const diff = diffWeeks(now, snapshot([], [], [risk({ id: "r1", kind: "ISSUE", status: "OPEN", title: "供應商延遲交貨" })]));
    const md = renderWeeklyReportMarkdown(now, diff);
    expect(md).toContain("### 風險與議題");
    expect(md).toContain("供應商延遲交貨");
    expect(md).toContain("未處理 → 處理中");
  });

  it("沒有登記風險/議題時說清楚,不是留白", () => {
    const md = renderWeeklyReportMarkdown(snapshot([]), noDiff);
    expect(md).toContain("沒有登記風險或議題");
  });

  it("已完成的里程碑不再列 —— 那一段問的是還沒到的", () => {
    const md = renderWeeklyReportMarkdown(
      snapshot([item({ id: "m", isMilestone: true, bucket: "done" })]),
      noDiff
    );
    expect(md).toContain("沒有未完成的里程碑");
  });

  it("未來幾天獨立一段,天數跟著 upcomingDays 走", () => {
    const md = renderWeeklyReportMarkdown(
      snapshot([item({ id: "u", bucket: "upcoming" })]),
      noDiff
    );
    expect(md).toContain("### 未來 7 天(1)");

    const data = snapshot([item({ id: "u", bucket: "upcoming" })]);
    data.upcomingDays = 14;
    expect(renderWeeklyReportMarkdown(data, noDiff)).toContain("### 未來 14 天(1)");
  });

  it("有上一週就給摘要數字", () => {
    const diff = diffWeeks(
      snapshot([item({ id: "a", bucket: "done" })]),
      snapshot([item({ id: "a", bucket: "other" })])
    );
    const md = renderWeeklyReportMarkdown(snapshot([item({ id: "a", bucket: "done" })]), diff);
    expect(md).toContain("完成 1・新逾期 0");
  });

  it("時程變化寫出前後與差幾天", () => {
    const diff = diffWeeks(
      snapshot([item({ id: "a", name: "PCBA", end: "2026-09-25" })]),
      snapshot([item({ id: "a", name: "PCBA", end: "2026-09-18" })])
    );
    const md = renderWeeklyReportMarkdown(snapshot([item({ id: "a", name: "PCBA", end: "2026-09-25" })]), diff);
    expect(md).toContain("延後 7 天");
  });

  it("開始超支會在摘要示警", () => {
    const now = snapshot([], [budget({ itemId: "p1", spent: 1_200_000, over: true })]);
    const diff = diffWeeks(now, snapshot([], [budget({ itemId: "p1", spent: 1_000, over: false })]));
    const md = renderWeeklyReportMarkdown(now, diff);
    expect(md).toContain("從沒超支變成超支");
  });

  it("依職能的工作項掛在對應的專案群組底下,DM 跟成員各自一份", () => {
    const data = snapshot([]);
    data.departments = [
      {
        userId: "u-henry",
        userName: "Henry Chen",
        role: "DM",
        discipline: "SW 軟體",
        programName: "M3",
        groupName: "M3",
        boardName: "M3專案",
        overdue: [item({ id: "o", bucket: "overdue" })],
        completedThisWeek: [],
        upcoming: [],
      },
      {
        userId: "u-ezra",
        userName: "Ezra Li",
        role: "MEMBER",
        discipline: "SW 軟體",
        programName: "M3",
        groupName: "M3",
        boardName: "M3專案",
        overdue: [],
        completedThisWeek: [],
        upcoming: [],
      },
    ];
    const md = renderWeeklyReportMarkdown(data, noDiff);
    expect(md).toContain("## 專案:M3");
    expect(md).toContain("#### SW 軟體");
    expect(md).toContain("**[DM] Henry Chen**");
    expect(md).toContain("**[成員] Ezra Li**");
    expect(md).toContain("**逾期(1)**");
  });

  it("不屬於這個專案群組的人不會混進來", () => {
    const data = snapshot([]);
    data.departments = [
      {
        userId: "u-other",
        userName: "Other Program",
        role: "MEMBER",
        discipline: "SW 軟體",
        programName: "AMR BOX",
        groupName: "AMR",
        boardName: "AMR 專案",
        overdue: [],
        completedThisWeek: [],
        upcoming: [],
      },
    ];
    const md = renderWeeklyReportMarkdown(data, noDiff);
    expect(md).toContain("## 專案:M3");
    expect(md).not.toContain("Other Program");
  });

  it("Team Leader 自己的工作項獨立列出,不掛在任何職能底下", () => {
    const data = snapshot([]);
    data.departments = [
      {
        userId: "u-lead",
        userName: "Jason Huang",
        role: "TEAM_LEADER",
        discipline: "Team Leader",
        programName: "M3",
        groupName: "M3",
        boardName: "M3專案",
        overdue: [],
        completedThisWeek: [item({ id: "c", bucket: "done" })],
        upcoming: [],
      },
    ];
    const md = renderWeeklyReportMarkdown(data, noDiff);
    expect(md).toContain("#### Team Leader");
    expect(md).toContain("**[Team Leader] Jason Huang**");
    expect(md).toContain("**這週已完成(1)**");
  });

  it("沒有部門名冊時說得出原因,而不是一段空白", () => {
    const md = renderWeeklyReportMarkdown(snapshot([]), noDiff);
    expect(md).toContain("沒有設定分組角色與部門名冊");
  });

  it("區塊可以個別關掉——專案週報分發用的內容範圍設定", () => {
    const data = snapshot([item({ id: "a", bucket: "overdue" })]);
    data.departments = [
      {
        userId: "u1",
        userName: "Henry Chen",
        role: "DM",
        discipline: "SW 軟體",
        programName: "M3",
        groupName: "M3",
        boardName: "M3專案",
        overdue: [],
        completedThisWeek: [],
        upcoming: [],
      },
    ];
    data.activity = [{ boardName: "M3專案", count: 3 }];

    const full = renderWeeklyReportMarkdown(data, noDiff);
    expect(full).toContain("## 本週摘要");
    expect(full).toContain("## 專案:M3");
    expect(full).toContain("### 依職能的工作項");
    expect(full).toContain("## 本週異動筆數");

    const minimal = renderWeeklyReportMarkdown(data, noDiff, {
      summary: false,
      programs: false,
      departments: false,
      activity: false,
    });
    expect(minimal).not.toContain("## 本週摘要");
    expect(minimal).not.toContain("## 專案:M3");
    expect(minimal).not.toContain("### 依職能的工作項");
    expect(minimal).not.toContain("## 本週異動筆數");
    // 標題跟視角那兩行不受影響,不是整份都被關掉了。
    expect(minimal).toContain("# 週報");
  });

  it("清單太長會收尾,不會把幾百項全部貼進信裡", () => {
    const many = Array.from({ length: 25 }, (_, i) => item({ id: `x${i}`, bucket: "overdue" }));
    const md = renderWeeklyReportMarkdown(snapshot(many), noDiff);
    expect(md).toContain("另外還有 10 項");
  });

  it("已完成的沒有到期日,不留一個空括號", () => {
    const now = snapshot([item({ id: "d", name: "做完了", end: null, bucket: "done" })]);
    const diff = diffWeeks(now, snapshot([item({ id: "d", name: "做完了", end: null })]));
    const md = renderWeeklyReportMarkdown(now, diff);
    expect(md).toContain("做完了");
    expect(md).not.toContain("做完了()");
  });
});

const update = (overrides: Partial<ItemUpdateLine> & { itemId: string }): ItemUpdateLine => ({
  wbsCode: "1.1",
  name: overrides.itemId,
  boardName: "M3專案",
  kind: "COMMENT",
  text: "已跟供應商確認交期",
  url: null,
  authorName: "Henry",
  date: "2026-09-16",
  ...overrides,
});

describe("工作項資訊更新(留言、連結、附件)", () => {
  it("同一個工作項的更新歸在一起,工作項依 WBS 編號排(1.2 在 1.10 前面)", () => {
    const groups = groupItemUpdates([
      update({ itemId: "b", wbsCode: "1.10", name: "後面的" }),
      update({ itemId: "a", wbsCode: "1.2", name: "前面的" }),
      update({ itemId: "a", wbsCode: "1.2", name: "前面的", kind: "LINK", url: "https://example.com/spec" }),
    ]);
    expect(groups.map((g) => g.itemId)).toEqual(["a", "b"]);
    expect(groups[0].updates).toHaveLength(2);
  });

  it("組內依日期排,同一天留言 → 連結 → 附件", () => {
    const [group] = groupItemUpdates([
      update({ itemId: "a", kind: "ATTACHMENT", text: "report.pdf", date: "2026-09-16" }),
      update({ itemId: "a", kind: "LINK", text: "規格", url: "https://e.com", date: "2026-09-16" }),
      update({ itemId: "a", kind: "COMMENT", date: "2026-09-17" }),
      update({ itemId: "a", kind: "COMMENT", date: "2026-09-16" }),
    ]);
    expect(group.updates.map((u) => `${u.date}${u.kind}`)).toEqual([
      "2026-09-16COMMENT",
      "2026-09-16LINK",
      "2026-09-16ATTACHMENT",
      "2026-09-17COMMENT",
    ]);
  });

  it("Markdown 有「工作項資訊更新」一段,連結附上網址", () => {
    const data = snapshot([]);
    data.programs[0].itemUpdates = [
      update({ itemId: "a", wbsCode: "1.4", name: "韌體開發", kind: "LINK", text: "設計文件", url: "https://example.com/doc" }),
      update({ itemId: "a", wbsCode: "1.4", name: "韌體開發", kind: "COMMENT", text: "已更新到 v2" }),
    ];
    const md = renderWeeklyReportMarkdown(data, diffWeeks(data, null));
    expect(md).toContain("### 工作項資訊更新(1)");
    expect(md).toContain("1.4 韌體開發");
    expect(md).toContain("🔗 連結(Henry 09-16):設計文件 <https://example.com/doc>");
    expect(md).toContain("💬 留言(Henry 09-16):已更新到 v2");
  });

  it("連結沒有取名字就只放網址", () => {
    const data = snapshot([]);
    data.programs[0].itemUpdates = [update({ itemId: "a", kind: "LINK", text: "https://e.com/x", url: "https://e.com/x" })];
    const md = renderWeeklyReportMarkdown(data, diffWeeks(data, null));
    expect(md).toContain("連結(Henry 09-16):<https://e.com/x>");
    expect(md).not.toContain("https://e.com/x <");
  });

  it("這週沒有新增時說清楚,不是留白", () => {
    const data = snapshot([]);
    data.programs[0].itemUpdates = [];
    const md = renderWeeklyReportMarkdown(data, diffWeeks(data, null));
    expect(md).toContain("這週沒有工作項新增留言、連結或附件");
  });

  it("舊版快照沒有這個欄位就不顯示這一段", () => {
    const md = renderWeeklyReportMarkdown(snapshot([]), diffWeeks(snapshot([]), null));
    expect(md).not.toContain("工作項資訊更新");
  });

  it("摘要列出有資訊更新的工作項數(同一個工作項只算一個)", () => {
    const data = snapshot([]);
    data.programs[0].itemUpdates = [
      update({ itemId: "a" }),
      update({ itemId: "a", kind: "LINK", url: "https://e.com", text: "x" }),
      update({ itemId: "b" }),
    ];
    const md = renderWeeklyReportMarkdown(data, diffWeeks(data, snapshot([])));
    expect(md).toContain("・資訊更新 2");
  });

  it("太多工作項時截斷並說還有幾個", () => {
    const data = snapshot([]);
    data.programs[0].itemUpdates = Array.from({ length: 25 }, (_, i) =>
      update({ itemId: `i${i}`, wbsCode: `1.${i + 1}` })
    );
    const md = renderWeeklyReportMarkdown(data, diffWeeks(data, null));
    expect(md).toContain("### 工作項資訊更新(25)");
    expect(md).toContain("……另外還有 5 個工作項");
  });
});

describe("這週已完成的工作項附上它的資訊更新", () => {
  /** 一個做完了、一個還沒做完的工作項,各有留言;這週完成的是 done 那個。 */
  function setup() {
    const before = snapshot([item({ id: "done", name: "ME 3D 出圖" }), item({ id: "open", name: "還沒做完", wbsCode: "1.2" })]);
    const now = snapshot([item({ id: "done", name: "ME 3D 出圖", bucket: "done" }), item({ id: "open", name: "還沒做完", wbsCode: "1.2", bucket: "overdue" })]);
    now.programs[0].itemUpdates = [
      update({ itemId: "done", name: "ME 3D 出圖", kind: "COMMENT", text: "已更新圖紙" }),
      update({ itemId: "done", name: "ME 3D 出圖", kind: "LINK", text: "3D 圖檔", url: "https://example.com/3d" }),
      update({ itemId: "open", name: "還沒做完", wbsCode: "1.2", text: "還在等廠商" }),
    ];
    return { now, diff: diffWeeks(now, before) };
  }

  it("工作項依編號分組後,查得到每個工作項自己的更新", () => {
    const map = updatesByItem([update({ itemId: "a" }), update({ itemId: "a", kind: "LINK", url: "https://e.com", text: "x" }), update({ itemId: "b" })]);
    expect(map.get("a")).toHaveLength(2);
    expect(map.get("b")).toHaveLength(1);
    expect(updatesByItem(undefined).size).toBe(0);
  });

  it("「完成」清單裡,完成的工作項底下接著它的留言與連結(連結附網址)", () => {
    const { now, diff } = setup();
    const md = renderWeeklyReportMarkdown(now, diff);
    const done = md.slice(md.indexOf("**完成(1)**"), md.indexOf("### 工作項資訊更新"));
    expect(done).toContain("ME 3D 出圖");
    expect(done).toContain("💬 留言(Henry 09-16):已更新圖紙");
    expect(done).toContain("🔗 連結(Henry 09-16):3D 圖檔 <https://example.com/3d>");
    expect(done).not.toContain("還在等廠商");
  });

  it("部門裡每個人的「這週已完成」也一樣附上", () => {
    const { now, diff } = setup();
    now.departments = [
      {
        userId: "u1",
        userName: "Henry",
        role: "DM",
        discipline: "SW 軟體",
        programName: "M3",
        groupName: "M3",
        boardName: "M3專案",
        overdue: [item({ id: "open", name: "還沒做完", wbsCode: "1.2", bucket: "overdue" })],
        completedThisWeek: [item({ id: "done", name: "ME 3D 出圖", bucket: "done" })],
        upcoming: [],
      },
    ];
    const md = renderWeeklyReportMarkdown(now, diff);
    const person = md.slice(md.indexOf("**這週已完成(1)**"), md.indexOf("### 目前逾期"));
    expect(person).toContain("💬 留言(Henry 09-16):已更新圖紙");
    expect(person).toContain("<https://example.com/3d>");
    // 逾期的不附(只有「這週已完成」附)。
    expect(person).not.toContain("還在等廠商");
  });

  it("一個工作項的更新太多時只列前幾筆,其餘說還有幾筆", () => {
    const { now, diff } = setup();
    now.programs[0].itemUpdates = Array.from({ length: 8 }, (_, i) =>
      update({ itemId: "done", name: "ME 3D 出圖", text: `第 ${i + 1} 則`, date: `2026-09-${String(15 + (i % 3)).padStart(2, "0")}` })
    );
    const md = renderWeeklyReportMarkdown(now, diff);
    expect(md).toContain("  - ……另外還有 3 筆");
  });

  it("完成的工作項這週沒有任何更新就不多出東西", () => {
    const { now, diff } = setup();
    now.programs[0].itemUpdates = [];
    const md = renderWeeklyReportMarkdown(now, diff);
    const done = md.slice(md.indexOf("**完成(1)**"), md.indexOf("### 工作項資訊更新"));
    expect(done).not.toContain("留言(");
  });
});

describe("風險與議題明細", () => {
  const md = (risks: RiskLine[]) => {
    const data = snapshot([], [], risks);
    return renderWeeklyReportMarkdown(data, diffWeeks(data, null));
  };

  it("逐筆列出名稱、狀態、負責人與到期日,類型標風險或議題", () => {
    const out = md([
      risk({ id: "r1", title: "電源模組可能缺貨", status: "MITIGATING", ownerName: "王小明", dueDate: "2026-10-20" }),
      risk({ id: "r2", kind: "ISSUE", title: "現場通訊中斷", status: "OPEN" }),
    ]);
    expect(out).toContain("**風險與議題明細**");
    expect(out).toContain("- [風險] 電源模組可能缺貨 — 處理中(分數 9)・負責:王小明・到期 2026-10-20");
    expect(out).toContain("- [議題] 現場通訊中斷 — 未處理(分數 9)");
  });

  it("帶出看板、說明、對策,Mantis 來的標編號並附網址", () => {
    const out = md([
      risk({ id: "r1", description: "供應商說交期延到十月底", mitigation: "找第二家供應商報價" }),
      risk({ id: "r2", kind: "ISSUE", mantisId: 321, mantisUrl: "https://mantis.example.com/view.php?id=321", title: "韌體升級後重開機" }),
    ]);
    expect(out).toContain("看板:M3專案");
    expect(out).toContain("說明:供應商說交期延到十月底");
    expect(out).toContain("對策:找第二家供應商報價");
    expect(out).toContain("[Mantis #321] 韌體升級後重開機");
    expect(out).toContain("Mantis:<https://mantis.example.com/view.php?id=321>");
  });

  it("這週有進度更新就列出來;沒有就放最近一次更新,說清楚不是這週的", () => {
    const out = md([
      risk({
        id: "r1",
        title: "有更新的",
        updates: [
          { authorName: "王小明", date: "2026-09-16", text: "已跟供應商確認" },
          { authorName: "李小華", date: "2026-09-18", text: "第二家報價回來了" },
        ],
        latestUpdate: { authorName: "李小華", date: "2026-09-18", text: "第二家報價回來了" },
      }),
      risk({ id: "r2", title: "這週沒更新的", latestUpdate: { authorName: "陳小美", date: "2026-08-30", text: "等客戶回覆" } }),
      risk({ id: "r3", title: "從來沒更新的" }),
    ]);
    expect(out).toContain("💬 更新(王小明 09-16):已跟供應商確認");
    expect(out).toContain("💬 更新(李小華 09-18):第二家報價回來了");
    expect(out).toContain("最近一次更新(陳小美 08-30):等客戶回覆");
    // 只看「從來沒更新的」那一筆自己的區塊(標題列加上縮排的子行),不要把後面別筆的更新算進來。
    const block = out.match(/- \[風險\] 從來沒更新的[^\n]*\n(?:  - [^\n]*\n?)*/)?.[0] ?? "";
    expect(block).toContain("從來沒更新的");
    expect(block).not.toContain("更新(");
    expect(block).not.toContain("最近一次更新");
  });

  it("一筆的進度更新太多時只列前 5 則,其餘說還有幾則", () => {
    const updates = Array.from({ length: 8 }, (_, i) => ({ authorName: "王小明", date: "2026-09-16", text: `第 ${i + 1} 則` }));
    const out = md([risk({ id: "r1", updates })]);
    expect(out).toContain("第 5 則");
    expect(out).not.toContain("第 6 則");
    expect(out).toContain("……另外還有 3 則更新");
  });

  it("已結案的只列這一週才動過的;分數高的在前,已結案的排最後", () => {
    const out = md([
      risk({ id: "old", title: "很久以前結案", status: "CLOSED", updatedAt: "2026-08-01T00:00:00.000Z" }),
      risk({ id: "fresh", title: "這週剛結案", status: "CLOSED", updatedAt: "2026-09-17T00:00:00.000Z" }),
      risk({ id: "low", title: "低分的", probability: 1, impact: 1 }),
      risk({ id: "high", title: "高分的", probability: 5, impact: 5 }),
    ]);
    expect(out).not.toContain("很久以前結案");
    const order = ["高分的", "低分的", "這週剛結案"].map((t) => out.indexOf(`] ${t}`));
    expect(order.every((i) => i > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("太多筆時截斷並說還有幾項", () => {
    const many = Array.from({ length: 25 }, (_, i) => risk({ id: `x${i}`, title: `風險 ${i}` }));
    const out = md(many);
    expect(out).toContain("- ……另外還有 5 項");
  });

  it("舊版快照(沒有明細欄位)照樣排得出來,不會多出空的段落", () => {
    const out = md([risk({ id: "r1", title: "舊的" })]);
    expect(out).toContain("[風險] 舊的 — 未處理");
    expect(out).not.toContain("說明:");
    expect(out).not.toContain("最近一次更新");
  });

  it("沒有任何風險議題時不出現明細段落", () => {
    expect(md([])).not.toContain("風險與議題明細");
  });
});

describe("分專案寄信", () => {
  const person = (programName: string | null): PersonSection => ({
    userId: "u1",
    userName: "Henry",
    role: "MEMBER",
    discipline: "SW 軟體",
    programName,
    groupName: "G",
    boardName: "B",
    overdue: [],
    completedThisWeek: [],
    upcoming: [],
  });

  function twoPrograms() {
    const a = item({ id: "a1", programName: "AMR BOX", bucket: "done" });
    const m = item({ id: "m1", programName: "M3", bucket: "done" });
    const before = snapshot([]);
    before.programs = [
      { ...program([item({ id: "a1", programName: "AMR BOX" })]), programName: "AMR BOX", boards: [{ boardId: "b2", boardName: "AMR BOX專案", programName: "AMR BOX", total: 1, done: 0, overdue: 0, inProgress: 1, notStarted: 0 }] },
      { ...program([item({ id: "m1", programName: "M3" })]), programName: "M3" },
    ];
    const now = snapshot([]);
    now.programs = [
      { ...program([a]), programName: "AMR BOX", boards: before.programs[0].boards },
      { ...program([m]), programName: "M3" },
    ];
    now.departments = [person("AMR BOX"), person("M3")];
    now.activity = [
      { boardName: "AMR BOX專案", count: 4 },
      { boardName: "M3專案", count: 9 },
    ];
    return { now, diff: diffWeeks(now, before) };
  }

  it("只留下這個專案的專案段落、部門與異動筆數", () => {
    const { now, diff } = twoPrograms();
    const sub = programSubset(now, diff, "AMR BOX");
    expect(sub.data.programs.map((p) => p.programName)).toEqual(["AMR BOX"]);
    expect(sub.data.departments).toHaveLength(1);
    expect(sub.data.activity).toEqual([{ boardName: "AMR BOX專案", count: 4 }]);
  });

  it("差異也只算這個專案的:信裡的摘要不會把別的專案的完成數加進來", () => {
    const { now, diff } = twoPrograms();
    expect(diff.completed).toHaveLength(2);
    const sub = programSubset(now, diff, "AMR BOX");
    expect(sub.diff.completed.map((i) => i.id)).toEqual(["a1"]);
    const md = renderWeeklyReportMarkdown(sub.data, sub.diff, { title: "AMR BOX週報" });
    expect(md.startsWith("# AMR BOX週報 2026 W38(2026-09-14 ~ 2026-09-20)")).toBe(true);
    expect(md).toContain("完成 1・");
    expect(md).not.toContain("## 專案:M3");
  });

  it("沒有歸屬專案群組的看板也能切出來", () => {
    const { now, diff } = twoPrograms();
    now.programs.push({ ...program([]), programName: null });
    expect(programSubset(now, diff, null).data.programs).toHaveLength(1);
  });

  it("標題:專案名稱 + 週報 + 週數 + 起訖", () => {
    expect(weeklyReportSubject("AMR BOX", "2026-10-05", "2026-10-11")).toBe("AMR BOX週報 W41 (2026-10-05 ~ 2026-10-11)");
    expect(weeklyReportSubject(null, "2026-10-05", "2026-10-11")).toBe("未歸屬專案群組週報 W41 (2026-10-05 ~ 2026-10-11)");
  });
});

describe("週報涵蓋的範圍(從星期幾到星期幾)", () => {
  const WED_TUE = DEFAULT_REPORT_RANGE; // 預設:週三到週二
  const MON_SUN = { startDow: 1, endDow: 0 };

  it("預設是週三到週二,共 7 天", () => {
    expect(WED_TUE).toEqual({ startDow: 3, endDow: 2 });
    expect(reportRangeDays(WED_TUE)).toBe(7);
  });

  it("天數:週一到週五 5 天、起訖同一天 1 天、週一到週日 7 天", () => {
    expect(reportRangeDays({ startDow: 1, endDow: 5 })).toBe(5);
    expect(reportRangeDays({ startDow: 4, endDow: 4 })).toBe(1);
    expect(reportRangeDays(MON_SUN)).toBe(7);
  });

  it("一天落在哪個範圍:週三到週二", () => {
    // 2026-10-07 是週三、2026-10-13 是下週二
    expect(reportRangeOf("2026-10-07", WED_TUE)).toEqual({ weekStart: "2026-10-07", weekEnd: "2026-10-13" });
    expect(reportRangeOf("2026-10-10", WED_TUE)).toEqual({ weekStart: "2026-10-07", weekEnd: "2026-10-13" });
    expect(reportRangeOf("2026-10-13", WED_TUE)).toEqual({ weekStart: "2026-10-07", weekEnd: "2026-10-13" });
    expect(reportRangeOf("2026-10-06", WED_TUE)).toEqual({ weekStart: "2026-09-30", weekEnd: "2026-10-06" });
  });

  it("週一到週日跟原本的 ISO 週一樣", () => {
    expect(reportRangeOf("2026-10-07", MON_SUN)).toEqual(weekRangeOf("2026-10-07"));
    expect(reportRangeOf("2026-10-11", MON_SUN)).toEqual(weekRangeOf("2026-10-11"));
  });

  it("不滿 7 天時,空檔那幾天回前一個範圍", () => {
    const monFri = { startDow: 1, endDow: 5 };
    expect(reportRangeOf("2026-10-07", monFri)).toEqual({ weekStart: "2026-10-05", weekEnd: "2026-10-09" });
    expect(reportRangeOf("2026-10-10", monFri)).toEqual({ weekStart: "2026-10-05", weekEnd: "2026-10-09" });
  });

  it("上一輪是往前 7 天,不管從星期幾開始", () => {
    expect(previousReportWeekStart("2026-10-07")).toBe("2026-09-30");
    expect(previousReportWeekStart("2026-01-05")).toBe("2025-12-29");
  });

  it("最近一個已經結束的範圍:最後一天還沒過完就不算", () => {
    // 週二 10-13 是範圍(10-07 ~ 10-13)的最後一天,還沒結束 → 報上一個
    expect(lastCompletedReportRange("2026-10-13", WED_TUE)).toEqual({ weekStart: "2026-09-30", weekEnd: "2026-10-06" });
    // 隔天週三,10-07 ~ 10-13 結束了
    expect(lastCompletedReportRange("2026-10-14", WED_TUE)).toEqual({ weekStart: "2026-10-07", weekEnd: "2026-10-13" });
    // 週一早上
    expect(lastCompletedReportRange("2026-10-12", WED_TUE)).toEqual({ weekStart: "2026-09-30", weekEnd: "2026-10-06" });
  });

  it("週一到週日時,週一早上報的是剛結束的那一週(跟原本一樣)", () => {
    expect(lastCompletedReportRange("2026-10-12", MON_SUN)).toEqual({ weekStart: "2026-10-05", weekEnd: "2026-10-11" });
    expect(lastCompletedReportRange("2026-10-11", MON_SUN)).toEqual({ weekStart: "2026-09-28", weekEnd: "2026-10-04" });
  });

  it("起訖不滿 7 天,空檔那天報剛結束的那個範圍", () => {
    expect(lastCompletedReportRange("2026-10-10", { startDow: 1, endDow: 5 })).toEqual({
      weekStart: "2026-10-05",
      weekEnd: "2026-10-09",
    });
  });

  it("週數標籤看最後一天落在哪個 ISO 週", () => {
    expect(reportWeekLabel("2026-10-06")).toBe("2026 W41");
    expect(reportWeekLabel("2026-10-13")).toBe("2026 W42");
    expect(reportWeekLabel("2026-10-11")).toBe("2026 W41");
  });

  it("標題與信件標題用最後一天的週數,範圍橫跨兩個日曆週也不亂", () => {
    expect(weeklyReportSubject("M3", "2026-09-30", "2026-10-06")).toBe("M3週報 W41 (2026-09-30 ~ 2026-10-06)");
    const data = snapshot([]);
    data.weekStart = "2026-09-30";
    data.weekEnd = "2026-10-06";
    expect(renderWeeklyReportMarkdown(data, diffWeeks(data, null)).startsWith("# 週報 2026 W41(2026-09-30 ~ 2026-10-06)")).toBe(true);
  });
});
