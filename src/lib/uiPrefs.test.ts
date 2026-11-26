import { describe, expect, it } from "vitest";
import { MAX_BOARDS, mergeUiPrefs, parseUiPrefs } from "./uiPrefs";

describe("parseUiPrefs:不信任讀進來的形狀", () => {
  it("不是物件就是空設定", () => {
    expect(parseUiPrefs(null)).toEqual({});
    expect(parseUiPrefs("x")).toEqual({});
  });
  it("丟掉不認得的欄位與不合法的值", () => {
    const out = parseUiPrefs({
      theme: "purple",
      boards: { b1: { view: "nope", tableTop: -5, gantt: { zoom: "year", scalePct: 999, collapsed: ["a", 3, ""], leftDay: "yesterday" } } },
    });
    expect(out.theme).toBeUndefined();
    expect(out.boards?.b1).toEqual({ tableTop: 0, gantt: { scalePct: 150, collapsed: ["a"] } });
  });
  it("合法的值原樣保留", () => {
    const input = { theme: "dark" as const, boards: { b1: { view: "gantt", gantt: { zoom: "month" as const, leftDay: "2026-11-20", top: 300 } } } };
    expect(parseUiPrefs(input)).toEqual(input);
  });
});

describe("mergeUiPrefs", () => {
  it("只換有給的欄位:更新捲動位置不會洗掉收合的列", () => {
    const first = mergeUiPrefs({}, { boards: { b1: { gantt: { collapsed: ["x", "y"], zoom: "day" } } } }, 100);
    const second = mergeUiPrefs(first, { boards: { b1: { gantt: { top: 500 } } } }, 200);
    expect(second.boards?.b1.gantt).toEqual({ collapsed: ["x", "y"], zoom: "day", top: 500 });
    expect(second.boards?.b1.at).toBe(200);
  });
  it("theme 與看板設定互不影響", () => {
    const a = mergeUiPrefs({ theme: "dark" }, { boards: { b1: { view: "table" } } }, 1);
    expect(a.theme).toBe("dark");
    const b = mergeUiPrefs(a, { theme: "light" }, 2);
    expect(b.theme).toBe("light");
    expect(b.boards?.b1.view).toBe("table");
  });
  it("看板記憶最多留 MAX_BOARDS 塊,淘汰最久沒更新的", () => {
    let prefs = {};
    for (let i = 0; i < MAX_BOARDS + 5; i++) prefs = mergeUiPrefs(prefs, { boards: { [`b${i}`]: { view: "table" } } }, i + 1);
    const ids = Object.keys(parseUiPrefs(prefs).boards ?? {});
    expect(ids).toHaveLength(MAX_BOARDS);
    expect(ids).not.toContain("b0");
    expect(ids).toContain(`b${MAX_BOARDS + 4}`);
  });
  it("壞的更動不會弄壞原本的設定", () => {
    const base = { theme: "dark" as const, boards: { b1: { view: "gantt" } } };
    expect(mergeUiPrefs(base, { boards: "garbage" }, 5)).toEqual(base);
  });
});

describe("各分頁的捲動位置", () => {
  it("只認得有捲動區的分頁,位置合法才留", () => {
    const out = parseUiPrefs({
      boards: { b1: { tableLeft: 320, scroll: { report: { top: 400, left: 0 }, table: { top: 1, left: 1 }, risks: { top: "x", left: 0 }, gates: { top: -9, left: 12.6 } } } },
    });
    expect(out.boards?.b1.tableLeft).toBe(320);
    expect(out.boards?.b1.scroll).toEqual({ report: { top: 400, left: 0 }, gates: { top: 0, left: 13 } });
  });
  it("逐分頁合併:更新報表的位置不會洗掉風險分頁的", () => {
    const a = mergeUiPrefs({}, { boards: { b1: { scroll: { risks: { top: 100, left: 0 } } } } }, 1);
    const b = mergeUiPrefs(a, { boards: { b1: { scroll: { report: { top: 250, left: 0 } } } } }, 2);
    expect(b.boards?.b1.scroll).toEqual({ risks: { top: 100, left: 0 }, report: { top: 250, left: 0 } });
  });
});

describe("表格展開 / 收起與看板橫向位置", () => {
  it("只留合法的 id;其他欄位照常", () => {
    const out = parseUiPrefs({ boards: { b1: { tableExpanded: ["a", "", 5, "b"], tableGroupsCollapsed: ["g1"], kanbanLeft: 640.4 } } });
    expect(out.boards?.b1).toEqual({ tableExpanded: ["a", "b"], tableGroupsCollapsed: ["g1"], kanbanLeft: 640 });
  });
  it("清單是整份換掉(展開的列變少就是變少),不是累加", () => {
    const a = mergeUiPrefs({}, { boards: { b1: { tableExpanded: ["x", "y"] } } }, 1);
    const b = mergeUiPrefs(a, { boards: { b1: { tableExpanded: ["y"] } } }, 2);
    expect(b.boards?.b1.tableExpanded).toEqual(["y"]);
    const c = mergeUiPrefs(b, { boards: { b1: { tableExpanded: [] } } }, 3);
    expect(c.boards?.b1.tableExpanded).toEqual([]);
  });
  it("分組收起的清單上限 200", () => {
    const many = Array.from({ length: 300 }, (_, i) => "g" + i);
    expect(parseUiPrefs({ boards: { b1: { tableGroupsCollapsed: many } } }).boards?.b1.tableGroupsCollapsed).toHaveLength(200);
  });
});
