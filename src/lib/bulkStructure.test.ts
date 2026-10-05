import { describe, expect, it } from "vitest";
import {
  collapseToRoots,
  lvlShiftFor,
  planCopy,
  planMoveToParent,
  remapPredValue,
  subtreeIdsOf,
  type BulkMoveWrite,
  type TreeNode,
} from "./bulkStructure";
import { buildWbsIndexFromItems } from "./predecessorLink";

// G1:  a(0) ─ a1(0), a2(1) ─ a21(0)      b(1)      c(2)
// G2:  x(0) ─ x1(0)                      y(1)
const items: TreeNode[] = [
  { id: "a", parentId: null, order: 0, groupId: "G1" },
  { id: "a1", parentId: "a", order: 0, groupId: "G1" },
  { id: "a2", parentId: "a", order: 1, groupId: "G1" },
  { id: "a21", parentId: "a2", order: 0, groupId: "G1" },
  { id: "b", parentId: null, order: 1, groupId: "G1" },
  { id: "c", parentId: null, order: 2, groupId: "G1" },
  { id: "x", parentId: null, order: 0, groupId: "G2" },
  { id: "x1", parentId: "x", order: 0, groupId: "G2" },
  { id: "y", parentId: null, order: 1, groupId: "G2" },
];

function applyWrites(list: TreeNode[], writes: BulkMoveWrite[]): TreeNode[] {
  const byId = new Map(writes.map((w) => [w.id, w]));
  return list.map((i) => {
    const w = byId.get(i.id);
    return w ? { ...i, parentId: w.parentId, order: w.order, groupId: w.groupId } : i;
  });
}

/** 某個父層底下由上而下的 id。 */
function childrenOrder(list: TreeNode[], parentId: string | null, groupId: string): string[] {
  return list
    .filter((i) => i.parentId === parentId && i.groupId === groupId)
    .sort((p, q) => p.order - q.order)
    .map((i) => i.id);
}

describe("collapseToRoots", () => {
  it("drops items whose ancestor is also selected", () => {
    expect(collapseToRoots(items, ["a", "a21", "b"], ["G1", "G2"])).toEqual(["a", "b"]);
  });

  it("keeps a selected child when its parent is not selected", () => {
    expect(collapseToRoots(items, ["a21", "a1"], ["G1", "G2"])).toEqual(["a1", "a21"]);
  });

  it("orders by group order, then by position in the tree", () => {
    const selected = ["y", "c", "x1", "a2"];
    expect(collapseToRoots(items, selected, ["G1", "G2"])).toEqual(["a2", "c", "x1", "y"]);
    expect(collapseToRoots(items, selected, ["G2", "G1"])).toEqual(["x1", "y", "a2", "c"]);
  });

  it("ignores ids that are not on the board", () => {
    expect(collapseToRoots(items, ["nope", "b"], ["G1"])).toEqual(["b"]);
  });
});

describe("planMoveToParent", () => {
  it("appends the root after the target's existing children and renumbers", () => {
    const result = planMoveToParent(items, ["b"], "a", "G1");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const next = applyWrites(items, result.writes);
    expect(childrenOrder(next, "a", "G1")).toEqual(["a1", "a2", "b"]);
    // 原本的最上層收斂成 0..n-1,不留空洞
    expect(childrenOrder(next, null, "G1")).toEqual(["a", "c"]);
    expect(next.filter((i) => i.groupId === "G1" && i.parentId === null).map((i) => i.order)).toEqual([0, 1]);
  });

  it("moves to the top level of the group, keeping the order of several roots", () => {
    const result = planMoveToParent(items, ["a21", "a1"], null, "G1");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const next = applyWrites(items, result.writes);
    expect(childrenOrder(next, null, "G1")).toEqual(["a", "b", "c", "a21", "a1"]);
    expect(childrenOrder(next, "a", "G1")).toEqual(["a2"]);
    expect(childrenOrder(next, "a2", "G1")).toEqual([]);
  });

  it("rewrites the group of the whole subtree when moving across groups", () => {
    const result = planMoveToParent(items, ["a"], "y", "G2");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const next = applyWrites(items, result.writes);
    for (const id of ["a", "a1", "a2", "a21"]) {
      expect(next.find((i) => i.id === id)!.groupId).toBe("G2");
    }
    // 子樹內部的父子關係不變
    expect(next.find((i) => i.id === "a21")!.parentId).toBe("a2");
    expect(next.find((i) => i.id === "a1")!.parentId).toBe("a");
    expect(next.find((i) => i.id === "a")!.parentId).toBe("y");
    // 舊分組的最上層收斂
    expect(childrenOrder(next, null, "G1")).toEqual(["b", "c"]);
    expect(next.filter((i) => i.groupId === "G1").map((i) => i.order).sort()).toEqual([0, 1]);
  });

  it("is a no-op when the root is already last under the target", () => {
    const result = planMoveToParent(items, ["a2"], "a", "G1");
    expect(result).toEqual({ ok: true, writes: [] });
  });

  it("rejects a target inside a moved subtree, or the root itself", () => {
    expect(planMoveToParent(items, ["a"], "a21", "G1")).toEqual({ ok: false, reason: "target-in-moved" });
    expect(planMoveToParent(items, ["a"], "a", "G1")).toEqual({ ok: false, reason: "target-in-moved" });
    expect(planMoveToParent(items, ["a", "b"], "a1", "G1")).toEqual({ ok: false, reason: "target-in-moved" });
  });

  it("rejects an unknown item and a parent that is not in the target group", () => {
    expect(planMoveToParent(items, ["nope"], null, "G1")).toEqual({ ok: false, reason: "not-found" });
    expect(planMoveToParent(items, ["b"], "nope", "G1")).toEqual({ ok: false, reason: "not-found" });
    expect(planMoveToParent(items, ["b"], "x", "G1")).toEqual({ ok: false, reason: "target-group-mismatch" });
  });

  it("moves roots from different parents and closes the gaps in both", () => {
    const result = planMoveToParent(items, ["a1", "x1"], "c", "G1");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const next = applyWrites(items, result.writes);
    expect(childrenOrder(next, "c", "G1")).toEqual(["a1", "x1"]);
    expect(next.find((i) => i.id === "x1")!.groupId).toBe("G1");
    expect(childrenOrder(next, "a", "G1")).toEqual(["a2"]);
    expect(next.find((i) => i.id === "a2")!.order).toBe(0);
    expect(childrenOrder(next, "x", "G2")).toEqual([]);
  });
});

describe("planCopy", () => {
  it("lists parents before children, renumbering each level from 0", () => {
    const plan = planCopy(items, ["a"], 5);
    expect(plan.map((p) => p.sourceId)).toEqual(["a", "a1", "a2", "a21"]);
    expect(plan).toEqual([
      { sourceId: "a", parentSourceId: null, order: 5 },
      { sourceId: "a1", parentSourceId: "a", order: 0 },
      { sourceId: "a2", parentSourceId: "a", order: 1 },
      { sourceId: "a21", parentSourceId: "a2", order: 0 },
    ]);
  });

  it("places several roots one after another from the first free order", () => {
    const plan = planCopy(items, ["b", "x1"], 3);
    expect(plan).toEqual([
      { sourceId: "b", parentSourceId: null, order: 3 },
      { sourceId: "x1", parentSourceId: null, order: 4 },
    ]);
  });

  it("keeps the relative order of siblings even when their order numbers have gaps", () => {
    const gappy: TreeNode[] = [
      { id: "p", parentId: null, order: 0, groupId: "G" },
      { id: "k2", parentId: "p", order: 9, groupId: "G" },
      { id: "k1", parentId: "p", order: 3, groupId: "G" },
    ];
    const plan = planCopy(gappy, ["p"], 0);
    expect(plan.map((p) => `${p.sourceId}:${p.order}`)).toEqual(["p:0", "k1:0", "k2:1"]);
  });
});

describe("subtreeIdsOf", () => {
  it("returns the roots and everything under them", () => {
    expect([...subtreeIdsOf(items, ["a2", "b"])].sort()).toEqual(["a2", "a21", "b"]);
  });
});

describe("lvlShiftFor", () => {
  it("shifts to parent Lvl + 1", () => {
    expect(lvlShiftFor(2, 3)).toBe(2);
    expect(lvlShiftFor(4, 1)).toBe(-2);
  });

  it("puts a top-level copy at Lvl 1", () => {
    expect(lvlShiftFor(3, null)).toBe(-2);
  });

  it("skips entirely rather than inventing a number", () => {
    expect(lvlShiftFor("x", 3)).toBeNull();
    expect(lvlShiftFor(undefined, 3)).toBeNull();
    expect(lvlShiftFor(2, undefined)).toBeNull();
  });
});

describe("remapPredValue", () => {
  const index = buildWbsIndexFromItems(items);
  const idMap = new Map([
    ["a", "a'"],
    ["a1", "a1'"],
  ]);

  it("points entries inside the copied set at their copies and keeps the rest", () => {
    expect(remapPredValue(index, "G1", "a1,b", idMap)).toBe("a1',b");
  });

  it("keeps each edge's own relationship and lag", () => {
    expect(remapPredValue(index, "G1", "a1:SS-2,b+3", idMap)).toBe("a1':SS-2,b+3");
  });

  it("resolves a legacy WBS code against the source item's own group", () => {
    // G1 的 "1.1" 是 a1;複本放進 G2 以後,寫出去的是 id,不會被當成 G2 的 "1.1"(x1)
    expect(remapPredValue(index, "G1", "1.1", idMap)).toBe("a1'");
    expect(remapPredValue(index, "G2", "1.1", idMap)).toBe("x1");
  });

  it("returns null when nothing resolves", () => {
    expect(remapPredValue(index, "G1", "", idMap)).toBeNull();
    expect(remapPredValue(index, "G1", null, idMap)).toBeNull();
    expect(remapPredValue(index, "G1", "ghost", idMap)).toBeNull();
  });
});
