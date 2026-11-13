import { describe, expect, it } from "vitest";
import { buildWbsIndexFromItems } from "@/lib/predecessorLink";
import {
  dependencyChain,
  dependencyEdgesOf,
  orderDependencyChain,
  type DependencyEdge,
  type DependencySourceItem,
} from "@/lib/dependencyChain";

const pred = (predId: string, succId: string): DependencyEdge => ({ predId, succId, kind: "pred", relationship: "FS" });

describe("dependencyChain", () => {
  // A → B → C → D,另有旁支 X → C(X 是 C 的前置)與 B → Y(Y 是 B 的後續)
  const edges = [pred("A", "B"), pred("B", "C"), pred("C", "D"), pred("X", "C"), pred("B", "Y")];

  it("選 C:往上整條前置(B、A、X),往下整條後續(D);B 的另一個後續 Y 是旁支,不算", () => {
    expect([...dependencyChain(edges, ["C"])].sort()).toEqual(["A", "B", "C", "D", "X"]);
  });

  it("選 B:前置 A,後續 C、D、Y;C 的另一個前置 X 是旁支,不算", () => {
    expect([...dependencyChain(edges, ["B"])].sort()).toEqual(["A", "B", "C", "D", "Y"]);
  });

  it("多選就是各自的鏈合起來", () => {
    expect([...dependencyChain(edges, ["A", "X"])].sort()).toEqual(["A", "B", "C", "D", "X", "Y"]);
  });

  it("沒有相依的項目只剩自己", () => {
    expect([...dependencyChain(edges, ["Z"])]).toEqual(["Z"]);
  });

  it("循環不會跑不完", () => {
    expect([...dependencyChain([pred("A", "B"), pred("B", "A")], ["A"])].sort()).toEqual(["A", "B"]);
  });
});

describe("orderDependencyChain", () => {
  it("前置一定排在後續上面,同一層依 rank", () => {
    const edges = [pred("A", "C"), pred("B", "C"), pred("C", "D")];
    const rank = { A: 2, B: 1, C: 0, D: 0 } as Record<string, number>;
    expect(orderDependencyChain(["D", "C", "B", "A"], edges, (id) => rank[id])).toEqual(["B", "A", "C", "D"]);
  });

  it("鏈外的邊不影響順序", () => {
    expect(orderDependencyChain(["B", "A"], [pred("A", "B"), pred("Q", "A")], () => 0)).toEqual(["A", "B"]);
  });

  it("有循環時每個項目還是都出現一次", () => {
    const out = orderDependencyChain(["A", "B", "C"], [pred("A", "B"), pred("B", "A"), pred("B", "C")], () => 0);
    expect([...out].sort()).toEqual(["A", "B", "C"]);
  });
});

describe("dependencyEdgesOf", () => {
  const items = [
    { id: "a", parentId: null, order: 0, groupId: "g" },
    { id: "b", parentId: null, order: 1, groupId: "g" },
    { id: "c", parentId: null, order: 2, groupId: "g" },
  ];
  const index = buildWbsIndexFromItems(items);
  const src = (id: string, predValue: unknown, constraintRefItemId: string | null = null): DependencySourceItem => ({
    id,
    groupId: "g",
    predValue,
    linkRelationship: "FS",
    constraintRefItemId,
  });

  it("Pred 欄(id 或 WBS 編號、多筆、帶關係)與日期約束的來源都是相依", () => {
    const edges = dependencyEdgesOf([src("b", "a"), src("c", "1,b:SS"), src("a", null, "c")], index);
    expect(edges).toEqual([
      { predId: "a", succId: "b", kind: "pred", relationship: "FS" },
      { predId: "a", succId: "c", kind: "pred", relationship: "FS" },
      { predId: "b", succId: "c", kind: "pred", relationship: "SS" },
      { predId: "c", succId: "a", kind: "constraint", relationship: null },
    ]);
  });

  it("指到不存在的項目就略過", () => {
    expect(dependencyEdgesOf([src("b", "nope"), src("c", null, "gone")], index)).toEqual([]);
  });
});
