import { describe, expect, it } from "vitest";
import {
  describeTargets,
  groupByPerson,
  parseSelectionKey,
  personState,
  selectionKey,
  targetsOf,
  togglePerson,
} from "./approvalSelection";

const rows = [
  { key: selectionKey("time", "t1"), userId: "u2", userName: "Schumi Su" },
  { key: selectionKey("time", "t2"), userId: "u2", userName: "Schumi Su" },
  { key: selectionKey("activity", "a1"), userId: "u2", userName: "Schumi Su" },
  { key: selectionKey("leave", "l1"), userId: "u2", userName: "Schumi Su" },
  { key: selectionKey("time", "t3"), userId: "u1", userName: "Amy Chen" },
];

describe("selectionKey / parseSelectionKey", () => {
  it("key 來回轉換;id 裡有冒號也沒關係", () => {
    expect(parseSelectionKey(selectionKey("time", "abc"))).toEqual({ kind: "time", id: "abc" });
    expect(parseSelectionKey("leave:x:y")).toEqual({ kind: "leave", id: "x:y" });
  });

  it("不認得的種類、沒有 id、沒有冒號:null", () => {
    expect(parseSelectionKey("bogus:1")).toBeNull();
    expect(parseSelectionKey("time:")).toBeNull();
    expect(parseSelectionKey("time")).toBeNull();
    expect(parseSelectionKey(":1")).toBeNull();
  });
});

describe("groupByPerson", () => {
  it("同一個人的三種待審歸在一起,依名字排序", () => {
    const groups = groupByPerson(rows);
    expect(groups.map((g) => g.userName)).toEqual(["Amy Chen", "Schumi Su"]);
    expect(groups[1].keys).toHaveLength(4);
    expect(groups[0].keys).toEqual([selectionKey("time", "t3")]);
  });

  it("兩個人同名也分開(用 id 分)", () => {
    const groups = groupByPerson([
      { key: "time:a", userId: "u1", userName: "王小明" },
      { key: "time:b", userId: "u2", userName: "王小明" },
    ]);
    expect(groups).toHaveLength(2);
  });
});

describe("personState / togglePerson", () => {
  const schumi = groupByPerson(rows)[1].keys;
  const amy = groupByPerson(rows)[0].keys;

  it("沒選 → 點人員:他所有待審(工時、會議工時、請假)全選,別人不動", () => {
    const next = togglePerson(new Set(), schumi);
    expect(personState(next, schumi)).toBe("all");
    expect(personState(next, amy)).toBe("none");
    expect(next.size).toBe(4);
  });

  it("只選了一部分 → 點人員:補成全選(不是取消)", () => {
    const partial = new Set([schumi[0]]);
    expect(personState(partial, schumi)).toBe("some");
    expect(personState(togglePerson(partial, schumi), schumi)).toBe("all");
  });

  it("已經全選 → 再點:只取消這個人,別人選的留著", () => {
    const both = togglePerson(togglePerson(new Set(), schumi), amy);
    const next = togglePerson(both, schumi);
    expect(personState(next, schumi)).toBe("none");
    expect(personState(next, amy)).toBe("all");
  });

  it("不會改動傳進來的集合", () => {
    const before = new Set([schumi[0]]);
    togglePerson(before, schumi);
    expect(before.size).toBe(1);
  });
});

describe("targetsOf / describeTargets", () => {
  it("轉成伺服器要的清單,不認得的 key 略過", () => {
    const targets = targetsOf(["time:t1", "leave:l1", "junk"]);
    expect(targets).toEqual([
      { kind: "time", id: "t1" },
      { kind: "leave", id: "l1" },
    ]);
  });

  it("確認視窗的說明:只列有選到的種類", () => {
    expect(describeTargets(targetsOf(["time:t1", "time:t2", "leave:l1"]))).toBe("工時 2、請假 1");
    expect(describeTargets(targetsOf(["activity:a1"]))).toBe("專案會議與其他工時 1");
    expect(describeTargets([])).toBe("");
  });
});
