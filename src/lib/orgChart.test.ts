import { describe, it, expect } from "vitest";
import { subordinateIds, teamIds, wouldCreateCycle, orgDepth } from "./orgChart";

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
