import { describe, it, expect } from "vitest";
import {
  weekRangeOf,
  previousWeekOf,
  isPastWeeklyTrigger,
  isoWeekLabel,
  diffWeeks,
  renderWeeklyReportMarkdown,
  type BudgetLine,
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
