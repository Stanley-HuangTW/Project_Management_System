import { describe, expect, it } from "vitest";
import {
  buildOrgForest,
  descendantNodeIds,
  findSupervisorCycle,
  nodeDepth,
  orgChildren,
  planOrgMove,
  planSupervisorSync,
  resolveOrgDrop,
  supervisorFromOrg,
  wouldCreateNodeCycle,
  type OrgNodeLite,
} from "@/lib/orgTree";

const node = (id: string, parentId: string | null, headId: string | null, order = 0): OrgNodeLite => ({ id, name: id, parentId, headId, order });

// 總經理室(ceo) ─ 研發處(rd, 主管 wu) ─ 硬體部(hw, 主管 huang) ─ 電子課(ee, 主管 zhu)
//                                     └ 軟體部(sw, 主管 chen)
const nodes = [
  node("ceo", null, "boss"),
  node("rd", "ceo", "wu"),
  node("hw", "rd", "huang"),
  node("sw", "rd", "chen"),
  node("ee", "hw", "zhu"),
];

describe("nodeDepth", () => {
  it("最上層是 1,每往下一層加 1", () => {
    expect(nodeDepth(nodes, "ceo")).toBe(1);
    expect(nodeDepth(nodes, "rd")).toBe(2);
    expect(nodeDepth(nodes, "ee")).toBe(4);
  });

  it("資料裡有環也不會跑不完", () => {
    const loop = [node("a", "b", null), node("b", "a", null)];
    expect(nodeDepth(loop, "a")).toBeGreaterThan(0);
  });
});

describe("wouldCreateNodeCycle", () => {
  it("掛到自己、掛到自己的下層都會成環", () => {
    expect(wouldCreateNodeCycle(nodes, "rd", "rd")).toBe(true);
    expect(wouldCreateNodeCycle(nodes, "rd", "ee")).toBe(true);
  });

  it("掛到別條線上、或變成最上層都沒問題", () => {
    expect(wouldCreateNodeCycle(nodes, "ee", "sw")).toBe(false);
    expect(wouldCreateNodeCycle(nodes, "ee", null)).toBe(false);
  });
});

describe("descendantNodeIds", () => {
  it("含自己與所有下層", () => {
    expect([...descendantNodeIds(nodes, "rd")].sort()).toEqual(["ee", "hw", "rd", "sw"]);
  });
});

describe("supervisorFromOrg", () => {
  it("部門成員的直屬主管是那個部門的主管", () => {
    expect(supervisorFromOrg(nodes, { id: "staff", orgNodeId: "ee" })).toBe("zhu");
  });

  it("部門主管本人往上找:直屬主管是上一層部門的主管", () => {
    expect(supervisorFromOrg(nodes, { id: "zhu", orgNodeId: "ee" })).toBe("huang");
    expect(supervisorFromOrg(nodes, { id: "huang", orgNodeId: "hw" })).toBe("wu");
    expect(supervisorFromOrg(nodes, { id: "wu", orgNodeId: "rd" })).toBe("boss");
  });

  it("最上層的主管沒有主管", () => {
    expect(supervisorFromOrg(nodes, { id: "boss", orgNodeId: "ceo" })).toBeNull();
  });

  it("部門沒有主管就跳過,找上一層", () => {
    const gap = [node("a", null, "top"), node("b", "a", null), node("c", "b", "lead")];
    expect(supervisorFromOrg(gap, { id: "lead", orgNodeId: "c" })).toBe("top");
    expect(supervisorFromOrg(gap, { id: "x", orgNodeId: "b" })).toBe("top");
  });

  it("兼任上下兩層主管:上一層也是自己就再往上", () => {
    const dual = [node("a", null, "top"), node("b", "a", "dual"), node("c", "b", "dual")];
    expect(supervisorFromOrg(dual, { id: "dual", orgNodeId: "c" })).toBe("top");
  });

  it("沒掛部門就是 null", () => {
    expect(supervisorFromOrg(nodes, { id: "x", orgNodeId: null })).toBeNull();
  });
});

describe("planSupervisorSync", () => {
  it("只列出跟現在不一樣的人,沒掛部門的人不動", () => {
    const people = [
      { id: "staff", orgNodeId: "ee", supervisorId: "wrong" },
      { id: "zhu", orgNodeId: "ee", supervisorId: "huang" },
      { id: "manual", orgNodeId: null, supervisorId: "somebody" },
    ];
    expect(planSupervisorSync(nodes, people)).toEqual([{ userId: "staff", supervisorId: "zhu" }]);
  });
});

describe("findSupervisorCycle", () => {
  it("正常的主管鏈沒有環", () => {
    const people = [
      { id: "a", supervisorId: "b" },
      { id: "b", supervisorId: "c" },
      { id: "c", supervisorId: null },
    ];
    expect(findSupervisorCycle(people, [])).toBeNull();
  });

  it("套用之後互為主管就是環", () => {
    const people = [
      { id: "a", supervisorId: null },
      { id: "b", supervisorId: "a" },
    ];
    expect(findSupervisorCycle(people, [{ userId: "a", supervisorId: "b" }])).not.toBeNull();
  });

  it("上層部門的主管掛在下層部門底下 → 算出來互為主管", () => {
    // wu 主管研發處(rd)、自己卻坐在硬體部(hw):huang 的主管算出 wu,wu 的主管算出 huang。
    const people = [
      { id: "wu", orgNodeId: "hw", supervisorId: null },
      { id: "huang", orgNodeId: "hw", supervisorId: null },
    ];
    const changes = planSupervisorSync(nodes, people);
    expect(findSupervisorCycle(people, changes)).not.toBeNull();
  });
});

describe("buildOrgForest", () => {
  it("依上下層組成樹,同一層照 order 排", () => {
    const forest = buildOrgForest([node("root", null, null), node("b", "root", null, 2), node("a", "root", null, 1)]);
    expect(forest).toHaveLength(1);
    expect(forest[0].children.map((c) => c.node.id)).toEqual(["a", "b"]);
  });

  it("成環的部門不會消失", () => {
    const forest = buildOrgForest([node("a", "b", null), node("b", "a", null)]);
    const ids = new Set<string>();
    const walk = (t: (typeof forest)[number]) => {
      ids.add(t.node.id);
      t.children.forEach(walk);
    };
    forest.forEach(walk);
    expect(ids).toEqual(new Set(["a", "b"]));
  });

  it("上層部門不存在的當作根", () => {
    const forest = buildOrgForest([node("orphan", "gone", null)]);
    expect(forest.map((t) => t.node.id)).toEqual(["orphan"]);
  });
});

// 公司(co) ─ 甲(a, 0) 乙(b, 1) 丙(c, 2);甲底下有 a1(0) a2(1)
const family = [
  node("co", null, null),
  node("a", "co", null, 0),
  node("b", "co", null, 1),
  node("c", "co", null, 2),
  node("a1", "a", null, 0),
  node("a2", "a", null, 1),
];

/** 把拖曳的結果套回去,再讀出某個上層底下的順序。 */
function applyDrop(draggedId: string, targetId: string, zone: "before" | "after" | "child") {
  const placement = resolveOrgDrop(family, draggedId, targetId, zone);
  if (!placement) return null;
  const updates = planOrgMove(family, draggedId, placement.parentId, placement.index);
  const next = family.map((n) => {
    const u = updates.find((x) => x.id === n.id);
    return u ? { ...n, parentId: u.parentId, order: u.order } : n;
  });
  return (parentId: string | null) => orgChildren(next, parentId).map((n) => n.id);
}

describe("orgChildren", () => {
  it("照 order 排,上層不存在的算最上層", () => {
    expect(orgChildren(family, "co").map((n) => n.id)).toEqual(["a", "b", "c"]);
    expect(orgChildren([node("x", "gone", null)], null).map((n) => n.id)).toEqual(["x"]);
  });
});

describe("resolveOrgDrop", () => {
  it("同一層:丙拖到甲前面 → 丙排第一", () => {
    expect(resolveOrgDrop(family, "c", "a", "before")).toEqual({ parentId: "co", index: 0 });
    expect(applyDrop("c", "a", "before")!("co")).toEqual(["c", "a", "b"]);
  });

  it("同一層:甲拖到丙後面 → 甲排最後", () => {
    expect(applyDrop("a", "c", "after")!("co")).toEqual(["b", "c", "a"]);
  });

  it("放到別的部門裡面 → 變成它最後一個下層", () => {
    expect(resolveOrgDrop(family, "c", "b", "child")).toEqual({ parentId: "b", index: 0 });
    expect(applyDrop("a2", "b", "child")!("b")).toEqual(["a2"]);
    expect(applyDrop("a2", "a", "child")).toBeNull(); // 本來就是甲的最後一個下層
  });

  it("跨層:a1 拖到丙前面 → 變成丙的同層,原來的上層少一個", () => {
    const children = applyDrop("a1", "c", "before")!;
    expect(children("co")).toEqual(["a", "b", "a1", "c"]);
    expect(children("a")).toEqual(["a2"]);
  });

  it("變成最上層:放在最上層部門的旁邊", () => {
    expect(resolveOrgDrop(family, "a", "co", "after")).toEqual({ parentId: null, index: 1 });
  });

  it("放到自己、自己的下層都不行(會繞成環)", () => {
    expect(resolveOrgDrop(family, "a", "a", "child")).toBeNull();
    expect(resolveOrgDrop(family, "a", "a1", "child")).toBeNull();
    expect(resolveOrgDrop(family, "a", "a2", "before")).toBeNull();
  });

  it("位置沒變就不用做", () => {
    expect(resolveOrgDrop(family, "b", "a", "after")).toBeNull();
    expect(resolveOrgDrop(family, "b", "c", "before")).toBeNull();
  });

  it("找不到部門回 null", () => {
    expect(resolveOrgDrop(family, "nope", "a", "before")).toBeNull();
    expect(resolveOrgDrop(family, "a", "nope", "before")).toBeNull();
  });
});

describe("planOrgMove", () => {
  it("新同層重新編成 0、1、2…,並列的 order 也理順", () => {
    const tied = [node("p", null, null), node("x", "p", null, 5), node("y", "p", null, 5), node("z", "p", null, 5)];
    const updates = planOrgMove(tied, "z", "p", 0);
    const orders = Object.fromEntries(updates.map((u) => [u.id, u.order]));
    expect(orders.z).toBe(0);
    expect([orders.x, orders.y]).toEqual([1, 2]);
  });

  it("只回傳有變的", () => {
    expect(planOrgMove(family, "b", "co", 1)).toEqual([]);
  });

  it("位置超出範圍就放最後", () => {
    const updates = planOrgMove(family, "a", "co", 99);
    expect(updates.find((u) => u.id === "a")?.order).toBe(2);
  });
});
