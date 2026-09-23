import { describe, it, expect } from "vitest";
import {
  weekRangeOf,
  previousWeekOf,
  isoWeekLabel,
  diffWeeks,
  renderWeeklyReportMarkdown,
  type BudgetLine,
  type ProgramSection,
  type ReportItem,
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

const program = (items: ReportItem[], budgets: BudgetLine[] = []): ProgramSection => ({
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
});

const snapshot = (items: ReportItem[], budgets: BudgetLine[] = []): WeeklyReportData => ({
  weekStart: "2026-09-14",
  weekEnd: "2026-09-20",
  generatedAt: "2026-09-21 08:00",
  viewerName: "Stanley Huang",
  programs: [program(items, budgets)],
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

  it("部門那一段照人分列,DM 跟成員各自一份", () => {
    const data = snapshot([]);
    data.departments = [
      {
        userId: "u-henry",
        userName: "Henry Chen",
        role: "DM",
        discipline: "SW 軟體",
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
        groupName: "M3",
        boardName: "M3專案",
        overdue: [],
        completedThisWeek: [],
        upcoming: [],
      },
    ];
    const md = renderWeeklyReportMarkdown(data, noDiff);
    expect(md).toContain("### [DM] Henry Chen・SW 軟體(M3專案 / M3)");
    expect(md).toContain("### [成員] Ezra Li・SW 軟體(M3專案 / M3)");
    expect(md).toContain("**逾期(1)**");
  });

  it("Team Leader 自己的工作項獨立列出,不掛在任何職能底下", () => {
    const data = snapshot([]);
    data.departments = [
      {
        userId: "u-lead",
        userName: "Jason Huang",
        role: "TEAM_LEADER",
        discipline: "Team Leader",
        groupName: "M3",
        boardName: "M3專案",
        overdue: [],
        completedThisWeek: [item({ id: "c", bucket: "done" })],
        upcoming: [],
      },
    ];
    const md = renderWeeklyReportMarkdown(data, noDiff);
    expect(md).toContain("### [Team Leader] Jason Huang・Team Leader(M3專案 / M3)");
    expect(md).toContain("**這週已完成(1)**");
  });

  it("沒有部門名冊時說得出原因,而不是一段空白", () => {
    const md = renderWeeklyReportMarkdown(snapshot([]), noDiff);
    expect(md).toContain("沒有設定分組角色與部門名冊");
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
