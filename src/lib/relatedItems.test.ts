import { describe, expect, it } from "vitest";
import { listDependentItems, listPredecessorItems } from "./predecessorLink";

const PRED = "col-pred";
const LINK = "col-link";
const START = "col-start";
const END = "col-end";
const columns = {
  predColumnId: PRED,
  linkColumnId: LINK,
  linkColumnOptions: { statuses: [{ id: "l_fs", label: "FS", color: "#000" }, { id: "l_ss", label: "SS", color: "#000" }] },
  startColumnId: START,
  endColumnId: END,
};

const item = (id: string, order: number, cells: Record<string, string>) => ({
  id,
  name: `名稱-${id}`,
  parentId: null,
  order,
  groupId: "g",
  cellValues: Object.entries(cells).map(([columnId, value]) => ({ columnId, value })) as never,
});

// A(1) → B(2) → C(3);另有 D(4) 也指向 B,B 指向 A 與 X(不存在於這一組)
const items = [
  item("a", 0, { [START]: "2027-01-01", [END]: "2027-01-05" }),
  item("b", 1, { [PRED]: "a,x:SS", [LINK]: "l_fs", [START]: "2027-01-06", [END]: "2027-01-10" }),
  item("c", 2, { [PRED]: "b", [LINK]: "l_ss", [START]: "2027-01-11", [END]: "2027-01-12" }),
  item("d", 3, { [PRED]: "b:FS" }),
];

describe("listPredecessorItems / listDependentItems:一體兩面", () => {
  it("前置:列出這個工作項 Pred 指到的、在這一組裡找得到的項目,帶關係與日期", () => {
    const preds = listPredecessorItems("b", items, columns);
    expect(preds).toEqual([
      { itemId: "a", wbsCode: "1", name: "名稱-a", link: "FS", start: "2027-01-01", end: "2027-01-05" },
    ]);
  });

  it("前置指到不在這一組的項目(別的分組 / 別的看板)就不列", () => {
    expect(listPredecessorItems("b", items, columns).map((p) => p.itemId)).not.toContain("x");
  });

  it("後續:誰把這個工作項當前置", () => {
    expect(listDependentItems("b", items, columns).map((d) => [d.itemId, d.link])).toEqual([
      ["c", "SS"],
      ["d", "FS"],
    ]);
  });

  it("沒有前置 / 沒有後續就是空的", () => {
    expect(listPredecessorItems("a", items, columns)).toEqual([]);
    expect(listDependentItems("d", items, columns)).toEqual([]);
  });

  it("沒有 Pred 欄、找不到項目時回空", () => {
    expect(listPredecessorItems("b", items, { ...columns, predColumnId: null })).toEqual([]);
    expect(listPredecessorItems("nope", items, columns)).toEqual([]);
  });

  it("多個前置依 WBS 編號排序", () => {
    const more = [...items, item("e", 4, { [PRED]: "c,a" })];
    expect(listPredecessorItems("e", more, columns).map((p) => p.itemId)).toEqual(["a", "c"]);
  });
});
