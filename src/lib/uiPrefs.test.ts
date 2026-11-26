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
