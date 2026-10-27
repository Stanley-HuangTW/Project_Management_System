import { describe, expect, it } from "vitest";
import { filterItemsKeepingAncestors, riskKindOf } from "./chatRefs";

describe("riskKindOf", () => {
  it("Mantis 同步來的是議題(不管登記冊裡標成風險還是問題)", () => {
    expect(riskKindOf({ kind: "ISSUE", mantisId: 123 })).toBe("mantis");
    expect(riskKindOf({ kind: "RISK", mantisId: 7 })).toBe("mantis");
  });
  it("自己登記的依風險 / 問題分", () => {
    expect(riskKindOf({ kind: "RISK", mantisId: null })).toBe("risk");
    expect(riskKindOf({ kind: "ISSUE", mantisId: null })).toBe("issue");
  });
});

describe("filterItemsKeepingAncestors", () => {
  // 1 POC → 1.1 機構 → 1.1.1 外殼打樣;1.2 電控;2 量產
  const items = [
    { id: "a", name: "POC", wbsCode: "1", parentId: null },
    { id: "b", name: "機構", wbsCode: "1.1", parentId: "a" },
    { id: "c", name: "外殼打樣", wbsCode: "1.1.1", parentId: "b" },
    { id: "d", name: "電控", wbsCode: "1.2", parentId: "a" },
    { id: "e", name: "量產", wbsCode: "2", parentId: null },
  ];

  it("沒有搜尋字:全部留下、順序不變、都不淡化", () => {
    const rows = filterItemsKeepingAncestors(items, "  ");
    expect(rows.map((r) => r.item.id)).toEqual(["a", "b", "c", "d", "e"]);
    expect(rows.every((r) => !r.muted)).toBe(true);
  });

  it("符合的留下,連同所有上層(上層淡化),不相干的拿掉", () => {
    const rows = filterItemsKeepingAncestors(items, "外殼");
    expect(rows.map((r) => [r.item.id, r.muted])).toEqual([
      ["a", true],
      ["b", true],
      ["c", false],
    ]);
  });

  it("可以用 WBS 代號找", () => {
    expect(filterItemsKeepingAncestors(items, "1.2").map((r) => r.item.id)).toEqual(["a", "d"]);
  });

  it("上層自己也符合就不淡化;不分大小寫", () => {
    const rows = filterItemsKeepingAncestors([{ id: "a", name: "POC Plan", wbsCode: "1", parentId: null }, { id: "b", name: "poc-3D", wbsCode: "1.1", parentId: "a" }], "POC");
    expect(rows.map((r) => [r.item.id, r.muted])).toEqual([
      ["a", false],
      ["b", false],
    ]);
  });

  it("找不到就是空的;資料有環也不會卡住", () => {
    expect(filterItemsKeepingAncestors(items, "不存在")).toEqual([]);
    const cyclic = [
      { id: "x", name: "甲", wbsCode: "1", parentId: "y" },
      { id: "y", name: "乙", wbsCode: "2", parentId: "x" },
    ];
    expect(filterItemsKeepingAncestors(cyclic, "甲").map((r) => r.item.id).sort()).toEqual(["x", "y"]);
  });
});
