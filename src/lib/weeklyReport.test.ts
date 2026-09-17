import { describe, it, expect } from "vitest";
import {
  weekRangeOf,
  previousWeekOf,
  isoWeekLabel,
  diffWeeks,
  renderWeeklyReportMarkdown,
  type ReportItem,
  type WeeklyReportData,
} from "@/lib/weeklyReport";

const item = (id: string, name = id, end = "2026-09-18"): ReportItem => ({
  id,
  wbsCode: "1.1",
  name,
  boardName: "M3專案",
  groupName: "M3",
  end,
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
    expect(previousWeekOf("2026-09-14")).toEqual({
      weekStart: "2026-09-07",
      weekEnd: "2026-09-13",
    });
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
    // 2026-12-28 那一週的週四是 2026-12-31,所以還是 2026 年的第 53 週。
    expect(isoWeekLabel("2026-12-28")).toBe("2026 W53");
  });

  it("跨年後第一週", () => {
    expect(isoWeekLabel("2027-01-04")).toBe("2027 W01");
  });
});

describe("跟上一週比", () => {
  it("沒有上一週就什麼都不宣稱", () => {
    const diff = diffWeeks({ done: [item("a")], overdue: [item("b")] }, null);
    expect(diff.firstEver).toBe(true);
    expect(diff.completed).toEqual([]);
    expect(diff.newlyOverdue).toEqual([]);
  });

  it("這週在已完成、上週不在 = 這週完成的", () => {
    const diff = diffWeeks(
      { done: [item("a"), item("b")], overdue: [] },
      { done: [item("a")], overdue: [] }
    );
    expect(diff.completed.map((i) => i.id)).toEqual(["b"]);
  });

  it("上週就完成的不會再算一次", () => {
    const diff = diffWeeks({ done: [item("a")], overdue: [] }, { done: [item("a")], overdue: [] });
    expect(diff.completed).toEqual([]);
  });

  it("這週逾期、上週不逾期 = 新逾期", () => {
    const diff = diffWeeks(
      { done: [], overdue: [item("a"), item("b")] },
      { done: [], overdue: [item("a")] }
    );
    expect(diff.newlyOverdue.map((i) => i.id)).toEqual(["b"]);
  });

  it("上週逾期、這週不逾期 = 脫離逾期", () => {
    const diff = diffWeeks({ done: [], overdue: [] }, { done: [], overdue: [item("a")] });
    expect(diff.recovered.map((i) => i.id)).toEqual(["a"]);
  });

  it("做完的不算「脫離逾期」—— 它已經在完成那一欄了", () => {
    // 一個逾期的工作項這週做完了。算成兩件事的話,同一件事會被數兩次。
    const diff = diffWeeks({ done: [item("a")], overdue: [] }, { done: [], overdue: [item("a")] });
    expect(diff.completed.map((i) => i.id)).toEqual(["a"]);
    expect(diff.recovered).toEqual([]);
  });
});

const data: WeeklyReportData = {
  weekStart: "2026-09-14",
  weekEnd: "2026-09-20",
  generatedAt: "2026-09-21 08:00",
  viewerName: "Stanley Huang",
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
  overdue: [item("o1", "逾期的")],
  upcoming: [item("u1", "快到期的")],
  doneTotal: 4,
  budgets: [
    {
      itemId: "p1",
      boardName: "M3專案",
      phaseName: "EFS",
      approved: 1_000_000,
      spent: 900_000,
      committed: 200_000,
      remaining: -100_000,
      over: true,
    },
  ],
  delays: [
    {
      boardName: "M3專案",
      projectDelayDays: 12,
      culprits: [{ wbsCode: "2.3", name: "PCBA", ownDelayDays: 5, downstreamCount: 7 }],
    },
  ],
  activity: [{ boardName: "M3專案", count: 31 }],
};

describe("Markdown", () => {
  it("標題帶週數與起訖", () => {
    const md = renderWeeklyReportMarkdown(data, diffWeeks({ done: [], overdue: [] }, null));
    expect(md.startsWith("# 週報 2026 W38(2026-09-14 ~ 2026-09-20)")).toBe(true);
  });

  it("第一份會說清楚沒得比,而不是留一排 0", () => {
    const md = renderWeeklyReportMarkdown(data, diffWeeks({ done: [], overdue: [] }, null));
    expect(md).toContain("這是第一份週報");
    expect(md).not.toContain("完成 0 項");
  });

  it("有上一週就給差異數字", () => {
    const diff = diffWeeks(
      { done: [item("a")], overdue: [item("o1")] },
      { done: [], overdue: [] }
    );
    const md = renderWeeklyReportMarkdown(data, diff);
    expect(md).toContain("完成 1 項・新逾期 1 項");
  });

  it("超支的階段點名,而且金額有千分位", () => {
    const md = renderWeeklyReportMarkdown(data, diffWeeks({ done: [], overdue: [] }, null));
    expect(md).toContain("1 個階段超支");
    expect(md).toContain("核准 1,000,000");
  });

  it("沒有超支就明講沒有,不是整段消失", () => {
    const md = renderWeeklyReportMarkdown(
      { ...data, budgets: [{ ...data.budgets[0], over: false }] },
      diffWeeks({ done: [], overdue: [] }, null)
    );
    expect(md).toContain("沒有超支的階段");
  });

  it("延誤區塊列出拖累最多的那幾項", () => {
    const md = renderWeeklyReportMarkdown(data, diffWeeks({ done: [], overdue: [] }, null));
    expect(md).toContain("整體晚 12 天");
    expect(md).toContain("後面壓著 7 項");
  });

  it("清單太長會收尾,不會把幾百項全部貼進信裡", () => {
    const many = Array.from({ length: 25 }, (_, i) => item(`x${i}`));
    const md = renderWeeklyReportMarkdown({ ...data, overdue: many }, diffWeeks({ done: [], overdue: [] }, null));
    expect(md).toContain("另外還有 5 項");
  });

  it("沒有看板時說得出來,而不是一張空表格", () => {
    const md = renderWeeklyReportMarkdown({ ...data, boards: [] }, diffWeeks({ done: [], overdue: [] }, null));
    expect(md).toContain("沒有看得到的看板。");
  });
});

describe("清單排版", () => {
  it("有到期日就寫出來", () => {
    const md = renderWeeklyReportMarkdown(data, diffWeeks({ done: [], overdue: [] }, null));
    expect(md).toContain("逾期的(2026-09-18)");
  });

  it("已完成的沒有到期日,不留一個空括號", () => {
    const doneItem = { ...item("d1", "做完了"), end: "" };
    const diff = diffWeeks({ done: [doneItem], overdue: [] }, { done: [], overdue: [] });
    const md = renderWeeklyReportMarkdown(data, diff);
    expect(md).toContain("做完了");
    expect(md).not.toContain("做完了()");
  });
});
