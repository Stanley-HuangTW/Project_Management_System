import { describe, expect, it } from "vitest";
import {
  buildOrgForest,
  descendantNodeIds,
  findSupervisorCycle,
  nodeDepth,
  planSupervisorSync,
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
