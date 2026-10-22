import { describe, it, expect } from "vitest";
import { deputyTeamIds, subordinateIds, teamIds, teamViewIds, wouldCreateCycle, orgDepth } from "./orgChart";

// Stanley(管理者) → Henry(主管) → Wenwei(團隊成員),外加一個不相干的分支。
const org = [
  { id: "stanley", supervisorId: null },
  { id: "henry", supervisorId: "stanley" },
  { id: "wenwei", supervisorId: "henry" },
  { id: "warren", supervisorId: "henry" },
  { id: "jason", supervisorId: null },
  { id: "janet", supervisorId: "jason" },
];

describe("subordinateIds", () => {
  it("走到隔階的部屬,不只直屬", () => {
    expect(subordinateIds(org, "stanley")).toEqual(new Set(["henry", "wenwei", "warren"]));
  });

  it("不含自己,也不含別的分支", () => {
    const ids = subordinateIds(org, "henry");
    expect(ids.has("henry")).toBe(false);
    expect(ids).toEqual(new Set(["wenwei", "warren"]));
  });

  it("最底層的人沒有下轄", () => {
    expect(subordinateIds(org, "wenwei").size).toBe(0);
  });

  it("資料裡有環也會停下來", () => {
    const looped = [
      { id: "a", supervisorId: "c" },
      { id: "b", supervisorId: "a" },
      { id: "c", supervisorId: "b" },
    ];
    expect(subordinateIds(looped, "a")).toEqual(new Set(["b", "c"]));
  });
});

describe("teamIds", () => {
  it("含自己", () => {
    expect(teamIds(org, "henry")).toEqual(new Set(["henry", "wenwei", "warren"]));
  });
});

// 研發處(Thomas)底下:新技術研發部(SY)、專案室(Thomas 兼任主管,底下還有試作課)、專案管理部(Charles)
const units = [
  { id: "rd", parentId: null, headId: "thomas" },
  { id: "nt", parentId: "rd", headId: "sy" },
  { id: "pr", parentId: "rd", headId: "thomas" },
  { id: "pm", parentId: "rd", headId: "charles" },
  { id: "lab", parentId: "pr", headId: "sam" },
];
const members = [
  { id: "thomas", orgNodeId: "rd" },
  { id: "rdA", orgNodeId: "rd" },
  { id: "sy", orgNodeId: "nt" },
  { id: "jaja", orgNodeId: "nt" },
  { id: "tony", orgNodeId: "pr" },
  { id: "schumi", orgNodeId: "pr" },
  { id: "thomas-also", orgNodeId: "pr" },
  { id: "charles", orgNodeId: "pm" },
  { id: "pm1", orgNodeId: "pm" },
  { id: "sam", orgNodeId: "lab" },
  { id: "s1", orgNodeId: "lab" },
  { id: "nobody", orgNodeId: null },
];

describe("deputyTeamIds", () => {
  it("副主管只看他那個部門(加底下子部門)的人,不是那位主管整條下轄(主管同時是更大部門的主管)", () => {
    // SY 是專案室的副主管:專案室成員 + 試作課的主管與成員;看不到研發處別的部門(新技術研發部、專案管理部)的人
    expect(deputyTeamIds(units, members, ["pr"])).toEqual(new Set(["tony", "schumi", "thomas-also", "sam", "s1"]));
  });

  it("不含部門自己的主管(就算他兼任、也被列在成員裡)", () => {
    const withHead = [...members, { id: "thomas", orgNodeId: "pr" }];
    expect(deputyTeamIds(units, withHead, ["pr"]).has("thomas")).toBe(false);
  });

  it("葉子部門:只有那個部門的成員", () => {
    expect(deputyTeamIds(units, members, ["pm"])).toEqual(new Set(["pm1"]));
  });

  it("副主管好幾個部門:名單合起來", () => {
    expect(deputyTeamIds(units, members, ["pm", "lab"])).toEqual(new Set(["pm1", "s1"]));
  });

  it("沒有部門、找不到的部門:空的;沒掛部門的人不會被算進來", () => {
    expect(deputyTeamIds(units, members, [])).toEqual(new Set());
    expect(deputyTeamIds(units, members, ["不存在"])).toEqual(new Set());
    expect(deputyTeamIds(units, members, ["rd"]).has("nobody")).toBe(false);
  });

  it("部門資料有環也停得下來", () => {
    const loop = [
      { id: "a", parentId: "b", headId: "ha" },
      { id: "b", parentId: "a", headId: "hb" },
    ];
    expect(deputyTeamIds(loop, [{ id: "m", orgNodeId: "b" }], ["a"])).toEqual(new Set(["hb", "m"]));
  });
});

describe("teamViewIds", () => {
  it("主管:自己加下轄(跟 teamIds 一樣)", () => {
    expect(teamViewIds(org, "henry", { isSupervisor: true, deputyTeam: [] })).toEqual(teamIds(org, "henry"));
  });

  it("副主管:自己加他負責部門的人", () => {
    expect(teamViewIds(org, "wenwei", { isSupervisor: false, deputyTeam: ["warren"] })).toEqual(new Set(["wenwei", "warren"]));
  });

  it("又是主管、又是副主管:兩邊合起來(SY:新技術研發部的主管、專案室的副主管)", () => {
    expect(teamViewIds(org, "henry", { isSupervisor: true, deputyTeam: ["janet"] })).toEqual(new Set(["henry", "wenwei", "warren", "janet"]));
  });

  it("不是主管、也不是任何部門的副主管:沒有團隊可看(null)", () => {
    expect(teamViewIds(org, "wenwei", { isSupervisor: false, deputyTeam: [] })).toBeNull();
  });
});

describe("wouldCreateCycle", () => {
  it("指自己", () => {
    expect(wouldCreateCycle(org, "henry", "henry")).toBe(true);
  });

  it("指給自己的直屬部屬", () => {
    expect(wouldCreateCycle(org, "henry", "wenwei")).toBe(true);
  });

  it("指給隔階的部屬 —— 兩階的時候不可能發生,三階就會", () => {
    expect(wouldCreateCycle(org, "stanley", "wenwei")).toBe(true);
  });

  it("指給別的分支沒問題", () => {
    expect(wouldCreateCycle(org, "henry", "jason")).toBe(false);
  });

  it("清空主管沒問題", () => {
    expect(wouldCreateCycle(org, "henry", null)).toBe(false);
  });
});

describe("orgDepth", () => {
  it("數到第幾階", () => {
    expect(orgDepth(org, "stanley")).toBe(1);
    expect(orgDepth(org, "henry")).toBe(2);
    expect(orgDepth(org, "wenwei")).toBe(3);
  });
});
