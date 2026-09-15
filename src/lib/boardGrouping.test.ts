import { describe, expect, it } from "vitest";
import { groupByBoardAndGroup } from "./boardGrouping";

const row = (boardId: string, boardName: string, groupId: string, groupName: string, id: string) => ({
  boardId,
  boardName,
  groupId,
  groupName,
  id,
});

describe("groupByBoardAndGroup", () => {
  it("收成看板 → 分組兩層,順序照傳進來的順序", () => {
    const grouped = groupByBoardAndGroup([
      row("b1", "AMR", "g1", "POC", "i1"),
      row("b1", "AMR", "g1", "POC", "i2"),
      row("b1", "AMR", "g2", "EVT", "i3"),
      row("b2", "M3", "g3", "DVT", "i4"),
    ]);

    expect(grouped.map((b) => b.boardName)).toEqual(["AMR", "M3"]);
    expect(grouped[0].groups.map((g) => g.groupName)).toEqual(["POC", "EVT"]);
    expect(grouped[0].groups[0].rows.map((r) => r.id)).toEqual(["i1", "i2"]);
  });

  it("每個看板帶著自己的筆數 —— 標題旁邊那個數字", () => {
    const grouped = groupByBoardAndGroup([
      row("b1", "AMR", "g1", "POC", "i1"),
      row("b1", "AMR", "g2", "EVT", "i2"),
      row("b2", "M3", "g3", "DVT", "i3"),
    ]);
    expect(grouped[0].count).toBe(2);
    expect(grouped[1].count).toBe(1);
  });

  it("同一組的列即使中間夾著別的看板也會收在一起", () => {
    const grouped = groupByBoardAndGroup([
      row("b1", "AMR", "g1", "POC", "i1"),
      row("b2", "M3", "g3", "DVT", "i2"),
      row("b1", "AMR", "g1", "POC", "i3"),
    ]);
    expect(grouped).toHaveLength(2);
    expect(grouped[0].groups[0].rows.map((r) => r.id)).toEqual(["i1", "i3"]);
  });

  it("不同看板用到同一個分組 id 也不會混在一起", () => {
    const grouped = groupByBoardAndGroup([
      row("b1", "AMR", "g1", "POC", "i1"),
      row("b2", "M3", "g1", "POC", "i2"),
    ]);
    expect(grouped[0].groups[0].rows).toHaveLength(1);
    expect(grouped[1].groups[0].rows).toHaveLength(1);
  });

  it("空的就是空的", () => {
    expect(groupByBoardAndGroup([])).toEqual([]);
  });
});
