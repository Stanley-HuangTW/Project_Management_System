import { describe, expect, it } from "vitest";
import {
  buildOrgForest,
  descendantNodeIds,
  findSupervisorCycle,
  flattenOrgForest,
  nodeDepth,
  orgHeadcounts,
  orgChildren,
  planOrgMove,
  planDisciplineSync,
  planSupervisorSync,
  resolveOrgDrop,
  supervisorFromOrg,
  unitCodesFromOrg,
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

// 公司 ─ 研發處(對應 PM)─ 硬體部(對應 EE)─ 電子課(沒有自己的對應)
//                       └ 軟體部(沒有對應,沿用研發處的 PM)
//        品質部(對應 QA + FAE,兩個)
const unitNodes: OrgNodeLite[] = [
  { ...node("co", null, null), unitCodes: [] },
  { ...node("rd", "co", null), unitCodes: ["PM"] },
  { ...node("hw", "rd", null), unitCodes: ["EE"] },
  { ...node("ee", "hw", null), unitCodes: [] },
  { ...node("sw", "rd", null) },
  { ...node("qa", "co", null), unitCodes: ["QA", "FAE"] },
  { ...node("qa1", "qa", null) },
];

describe("unitCodesFromOrg", () => {
  it("自己有對應就用自己的(可以好幾個)", () => {
    expect(unitCodesFromOrg(unitNodes, "hw")).toEqual(["EE"]);
    expect(unitCodesFromOrg(unitNodes, "qa")).toEqual(["QA", "FAE"]);
  });

  it("沒有對應就沿用最近的上層(也是整組)", () => {
    expect(unitCodesFromOrg(unitNodes, "ee")).toEqual(["EE"]);
    expect(unitCodesFromOrg(unitNodes, "sw")).toEqual(["PM"]);
    expect(unitCodesFromOrg(unitNodes, "qa1")).toEqual(["QA", "FAE"]);
  });

  it("一路到頂都沒有對應、或沒掛部門 → 空的", () => {
    expect(unitCodesFromOrg(unitNodes, "co")).toEqual([]);
    expect(unitCodesFromOrg(unitNodes, null)).toEqual([]);
    expect(unitCodesFromOrg(unitNodes, "gone")).toEqual([]);
  });

  it("資料有環也不會跑不完", () => {
    expect(unitCodesFromOrg([node("a", "b", null), node("b", "a", null)], "a")).toEqual([]);
  });
});

describe("planDisciplineSync", () => {
  const people = [
    { id: "p1", orgNodeId: "ee", discipline: "PM" }, // 對應只有 EE → 改成 EE
    { id: "p2", orgNodeId: "sw", discipline: "PM" }, // 已經是 PM
    { id: "p3", orgNodeId: "co", discipline: "SW" }, // 部門沒有對應 → 不動
    { id: "p4", orgNodeId: null, discipline: "ME" }, // 沒掛部門 → 不動
    { id: "p5", orgNodeId: "hw", discipline: null }, // 還沒有單位 → 帶入 EE
    { id: "p6", orgNodeId: "qa", discipline: "FAE" }, // 對應有 QA + FAE,他本來就是 FAE → 維持
    { id: "p7", orgNodeId: "qa1", discipline: null }, // 對應有兩個,沒辦法替他選 → 不動
    { id: "p8", orgNodeId: "qa", discipline: "SW" }, // 對應有兩個,他現在的單位不在其中 → 也不動(由人選)
  ];

  it("只回傳跟現在不一樣的:對應只有一個才替他決定;有好幾個就維持現狀", () => {
    expect(planDisciplineSync(unitNodes, people)).toEqual([
      { userId: "p1", discipline: "EE" },
      { userId: "p5", discipline: "EE" },
    ]);
  });
});

describe("flattenOrgForest", () => {
  it("由上到下、同層照順序,帶層級", () => {
    expect(flattenOrgForest(family).map((x) => `${x.node.id}:${x.depth}`)).toEqual(["co:1", "a:2", "a1:3", "a2:3", "b:2", "c:2"]);
  });

  it("沒有部門 → 空的", () => {
    expect(flattenOrgForest([])).toEqual([]);
  });
});

describe("orgHeadcounts", () => {
  // 公司(主管 boss,本人掛在公司)─ 研發處(主管 boss,兼任;成員 a)─ 硬體部(主管 h,本人掛在研發處;成員 b、c)─ 軟體部(沒有主管、沒有成員)
  const tree: OrgNodeLite[] = [node("co", null, "boss"), node("rd", "co", "boss"), node("hw", "rd", "h"), node("sw", "rd", null)];
  const people = [
    { id: "boss", orgNodeId: "co" },
    { id: "a", orgNodeId: "rd" },
    { id: "h", orgNodeId: "rd" },
    { id: "b", orgNodeId: "hw" },
    { id: "c", orgNodeId: "hw" },
    { id: "free", orgNodeId: null },
  ];
  const counts = orgHeadcounts(tree, people);

  it("兼任的主管算在他當主管的那個部門:研發處的 boss 是兼任,也算 1 人", () => {
    expect(counts.get("rd")?.own).toBe(3); // a、h、boss(兼任)
    expect(counts.get("hw")?.own).toBe(3); // b、c、h(兼任)
  });

  it("沒有成員也沒有主管的部門是 0", () => {
    expect(counts.get("sw")).toEqual({ own: 0, total: 0 });
  });

  it("上層是底下所有部門的總數,同一個人只算一次", () => {
    expect(counts.get("rd")?.total).toBe(5); // boss、a、h、b、c
    expect(counts.get("co")?.total).toBe(5); // 公司本身 boss,底下沒有新的人
    expect(counts.get("hw")?.total).toBe(3);
  });

  it("沒有掛部門的人不算", () => {
    const all = [...counts.values()].reduce((max, c) => Math.max(max, c.total), 0);
    expect(all).toBe(5);
  });
});
